// Business operations shared by API routes and the background agent.
import type { DB } from "../supabase/clients";
import type { JobRow, NormalizedJob } from "../types";
import type { UserContext } from "./context";
import { tailorResume, makeFileName, type TailoredResume } from "../resume/tailor";
import { generateLetter, answerQuestions, analyzeJobAI, STANDARD_QUESTIONS, type LetterKind, type LibraryAnswer } from "../ai/tasks";
import { aiAvailable } from "../ai/provider";
import { scoreFor } from "./pipeline";
import { setApplicationStatus } from "./records";
import { logEvent, notify } from "./events";
import { enqueue } from "./queue";

export async function getJob(db: DB, userId: string, jobId: string): Promise<JobRow> {
  const { data, error } = await db.from("jobs").select("*").eq("user_id", userId).eq("id", jobId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Job not found");
  return data as JobRow;
}

export function requireProfile(ctx: UserContext) {
  if (!ctx.hasProfile) throw new Error("Upload a resume or fill in your profile in Resume Studio first.");
}

export async function analyzeJob(db: DB, ctx: UserContext, jobId: string) {
  const job = await getJob(db, ctx.userId, jobId);
  requireProfile(ctx);
  const match = scoreFor(ctx, job as NormalizedJob);
  let ai: Record<string, unknown> | null = null;
  let aiError: string | null = null;
  if (aiAvailable(ctx.ai)) {
    try {
      ai = await analyzeJobAI(ctx.ai, ctx.profile, job);
    } catch (e) {
      aiError = (e as Error).message;
    }
  }
  const patch: Record<string, unknown> = { match_score: match?.overall ?? null, match_analysis: match, analyzed_at: new Date().toISOString() };
  if (ai) patch.ai_analysis = { ...ai, model: ctx.ai.model, at: new Date().toISOString() };
  await db.from("jobs").update(patch).eq("id", jobId).eq("user_id", ctx.userId);
  return { match, ai, aiError };
}

export async function createTailoredResume(db: DB, ctx: UserContext, jobId: string, opts: { auto?: boolean } = {}) {
  requireProfile(ctx);
  const job = await getJob(db, ctx.userId, jobId);
  const { resume, method, issues } = await tailorResume(ctx.profile, job, ctx.ai, { tone: ctx.settings.ai.tailoring_tone });
  const { data: prev } = await db.from("resume_versions").select("version").eq("user_id", ctx.userId).eq("job_id", jobId).order("version", { ascending: false }).limit(1);
  const version = (prev?.[0]?.version ?? 0) + 1;
  const { data: primary } = await db.from("resumes").select("id").eq("user_id", ctx.userId).eq("is_primary", true).maybeSingle();
  const fileName = makeFileName(job) + (version > 1 ? `_v${version}` : "");
  const { data, error } = await db
    .from("resume_versions")
    .insert({
      user_id: ctx.userId,
      job_id: jobId,
      resume_id: primary?.id ?? null,
      generated_content: resume,
      change_log: [...resume.changes.map((c) => ({ type: "change", text: c })), ...issues.map((i) => ({ type: "rejected", text: `${i.reason}: “${i.rejected}”` }))],
      method,
      file_name: fileName,
      version,
    })
    .select("id, version, file_name")
    .single();
  if (error) throw new Error(error.message);
  const app = await setApplicationStatus(db, ctx.userId, jobId, "resume_generated", { by: opts.auto ? "agent" : "user", onlyForward: true, extra: { resume_version_id: data.id } });
  await logEvent(db, ctx.userId, "resume_generated", `Tailored resume v${version} for ${job.title} — ${job.company} (${method === "ai" ? "AI rewrite, truth-checked" : "rule-based"})`, { job_id: jobId, version_id: data.id, rejected: issues.length });
  if (opts.auto) await notify(db, ctx.userId, ctx.settings, { type: "resume", title: `Resume ready: ${job.title} — ${job.company}`, link: `/jobs/${jobId}` });
  return { ...data, method, issues, application_id: app.id, resume };
}

export async function createLetter(db: DB, ctx: UserContext, jobId: string, kind: LetterKind = "cover_letter", tone = "professional", instruction?: string) {
  requireProfile(ctx);
  const job = await getJob(db, ctx.userId, jobId);
  const out = await generateLetter(ctx.ai, ctx.profile, job, kind, tone, instruction);
  const { data: prev } = await db.from("cover_letters").select("version").eq("user_id", ctx.userId).eq("job_id", jobId).eq("kind", kind).order("version", { ascending: false }).limit(1);
  const { data, error } = await db
    .from("cover_letters")
    .insert({ user_id: ctx.userId, job_id: jobId, kind, tone, content: out.content, flags: out.flags, method: out.method, version: (prev?.[0]?.version ?? 0) + 1 })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  if (kind === "cover_letter") {
    const { data: app } = await db.from("applications").select("id").eq("user_id", ctx.userId).eq("job_id", jobId).maybeSingle();
    if (app) await db.from("applications").update({ cover_letter_id: data.id, cover_letter: out.content }).eq("id", app.id);
  }
  await logEvent(db, ctx.userId, "letter_generated", `Generated ${kind.replace("_", " ")} for ${job.company}`, { job_id: jobId });
  return data;
}

export async function createAnswers(db: DB, ctx: UserContext, jobId: string, questions?: string[]) {
  requireProfile(ctx);
  const job = await getJob(db, ctx.userId, jobId);
  const { data: lib } = await db.from("answer_library").select("key, question, answer, verified").eq("user_id", ctx.userId);
  const answers = await answerQuestions(ctx.ai, ctx.profile, ctx.preferences, (lib ?? []) as LibraryAnswer[], job, questions?.length ? questions : STANDARD_QUESTIONS);
  const { data: app } = await db.from("applications").select("id").eq("user_id", ctx.userId).eq("job_id", jobId).maybeSingle();
  // Replace unapproved answers for the same questions; keep approved ones.
  const { data: existing } = await db.from("application_answers").select("id, question, approved").eq("user_id", ctx.userId).eq("job_id", jobId);
  const approvedQs = new Set((existing ?? []).filter((e) => e.approved).map((e) => e.question));
  const toDelete = (existing ?? []).filter((e) => !e.approved && answers.some((a) => a.question === e.question)).map((e) => e.id);
  if (toDelete.length) await db.from("application_answers").delete().in("id", toDelete);
  const rows = answers
    .filter((a) => !approvedQs.has(a.question))
    .map((a) => ({ user_id: ctx.userId, job_id: jobId, application_id: app?.id ?? null, question: a.question, answer: a.answer, source: a.source, flags: a.flags, approved: a.source === "library" && a.flags.length === 0 }));
  if (rows.length) {
    const { error } = await db.from("application_answers").insert(rows);
    if (error) throw new Error(error.message);
  }
  return answers;
}

export function supportedAts(url: string | null | undefined): "greenhouse" | "lever" | "ashby" | null {
  if (!url) return null;
  if (/(boards|job-boards)\.greenhouse\.io|greenhouse\.io\/.*\/jobs\//.test(url)) return "greenhouse";
  if (/jobs\.lever\.co\//.test(url)) return "lever";
  if (/jobs\.ashbyhq\.com\//.test(url)) return "ashby";
  return null;
}

/** Daily / weekly / per-company / per-source application limits. */
export async function checkLimits(db: DB, ctx: UserContext, job: Pick<JobRow, "company" | "source">): Promise<{ ok: boolean; reason?: string }> {
  const a = ctx.settings.automation;
  const day = new Date(Date.now() - 864e5).toISOString();
  const week = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data } = await db.from("applications").select("applied_at, jobs!inner(company, source)").eq("user_id", ctx.userId).gte("applied_at", week);
  const rows = (data ?? []) as unknown as { applied_at: string; jobs: { company: string; source: string } }[];
  const today = rows.filter((r) => r.applied_at >= day);
  if (today.length >= a.daily_limit) return { ok: false, reason: `Daily limit reached (${a.daily_limit})` };
  if (rows.length >= a.weekly_limit) return { ok: false, reason: `Weekly limit reached (${a.weekly_limit})` };
  if (rows.filter((r) => r.jobs.company.toLowerCase() === job.company.toLowerCase()).length >= a.per_company_limit) return { ok: false, reason: `Per-company limit reached for ${job.company}` };
  if (today.filter((r) => r.jobs.source === job.source).length >= a.per_source_daily_limit) return { ok: false, reason: `Per-source daily limit reached for ${job.source}` };
  return { ok: true };
}

/**
 * Prepare an application package and route it according to automation mode + thresholds:
 *   score ≥ auto_apply_min & mode=auto & supported ATS → browser task with autoSubmit
 *   score ≥ approval_min (or mode=assisted)            → browser task that fills, then waits for approval
 *   otherwise / mode=manual                            → "ready_to_apply" with checklist (you apply)
 */
export async function prepareApplication(db: DB, ctx: UserContext, jobId: string, opts: { by?: "user" | "agent"; forceMode?: "manual" | "assisted" | "auto" } = {}) {
  const job = await getJob(db, ctx.userId, jobId);
  const { data: app } = await db.from("applications").select("id, application_status, resume_version_id").eq("user_id", ctx.userId).eq("job_id", jobId).maybeSingle();
  if (app && ["applied", "application_confirmed", "interview", "offer", "assessment", "recruiter_contacted"].includes(app.application_status))
    return { route: "already_applied" as const, reason: "Already applied — duplicate application prevented." };

  let versionId = app?.resume_version_id as string | null;
  if (!versionId) versionId = (await createTailoredResume(db, ctx, jobId, { auto: opts.by === "agent" })).id;
  const { data: letter } = await db.from("cover_letters").select("id").eq("user_id", ctx.userId).eq("job_id", jobId).eq("kind", "cover_letter").limit(1);
  if (!letter?.length) await createLetter(db, ctx, jobId, "cover_letter", "professional");
  const { count } = await db.from("application_answers").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId).eq("job_id", jobId);
  if (!count) await createAnswers(db, ctx, jobId);

  const mode = opts.forceMode ?? ctx.settings.automation.mode;
  const score = job.match_score ?? 0;
  const a = ctx.settings.automation;
  const ats = supportedAts(job.apply_url ?? job.source_url);
  const atsAllowed = !!ats && a.allowed_auto_sources.includes(ats);

  if (mode === "manual" || !ats || !atsAllowed || score < a.approval_min_score) {
    const reason = mode === "manual" ? "Manual mode" : !ats ? "No supported automated form for this site — apply via the extension or manually" : !atsAllowed ? `${ats} is not in your allowed auto sources` : `Score ${score} is below your approval threshold (${a.approval_min_score})`;
    await setApplicationStatus(db, ctx.userId, jobId, "ready_to_apply", { by: opts.by ?? "user", onlyForward: true, note: reason, extra: { mode: "manual", resume_version_id: versionId } });
    await logEvent(db, ctx.userId, "application_ready", `Application package ready for ${job.title} — ${job.company}`, { job_id: jobId, reason });
    return { route: "manual" as const, reason };
  }
  const limits = await checkLimits(db, ctx, job);
  if (!limits.ok) {
    await setApplicationStatus(db, ctx.userId, jobId, "ready_to_apply", { by: "agent", onlyForward: true, note: limits.reason });
    return { route: "limited" as const, reason: limits.reason };
  }
  const autoSubmit = mode === "auto" && score >= a.auto_apply_min_score;
  const t = await enqueue(db, ctx.userId, "application_submission", { jobId, requiresBrowser: true, payload: { ats, autoSubmit, resume_version_id: versionId } });
  await setApplicationStatus(db, ctx.userId, jobId, "ready_to_apply", { by: opts.by ?? "user", onlyForward: true, note: autoSubmit ? "Queued for auto-submit (local browser worker)" : "Queued for assisted fill (review before submit)", extra: { mode: autoSubmit ? "auto" : "assisted", resume_version_id: versionId } });
  await logEvent(db, ctx.userId, "application_queued", `${autoSubmit ? "Auto-apply" : "Assisted fill"} queued: ${job.title} — ${job.company} (${ats})`, { job_id: jobId, task_id: t.id });
  return { route: autoSubmit ? ("auto" as const) : ("assisted" as const), taskId: t.id };
}

/** Status monitoring: follow-ups due, upcoming interviews, expired postings. */
export async function monitorStatus(db: DB, ctx: UserContext, telegramToken?: string | null) {
  const now = new Date();
  let notified = 0;
  const { data: due } = await db.from("followups").select("id, due_at, type, note, application_id, applications!inner(job_id, jobs!inner(title, company))").eq("user_id", ctx.userId).eq("status", "pending").lte("due_at", now.toISOString()).is("notified_at", null);
  for (const f of (due ?? []) as unknown as { id: string; type: string; note: string | null; applications: { job_id: string; jobs: { title: string; company: string } } }[]) {
    await notify(db, ctx.userId, ctx.settings, { type: "followup", title: `Follow-up due: ${f.applications.jobs.title} — ${f.applications.jobs.company}`, content: f.note ?? undefined, link: `/applications?job=${f.applications.job_id}` }, { telegramToken });
    await db.from("followups").update({ notified_at: now.toISOString() }).eq("id", f.id);
    notified++;
  }
  // applications with follow_up_date today and no followup row
  const today = now.toISOString().slice(0, 10);
  const { data: fu } = await db.from("applications").select("id, follow_up_date").eq("user_id", ctx.userId).lte("follow_up_date", today).not("follow_up_date", "is", null);
  for (const a of fu ?? []) {
    const { count } = await db.from("followups").select("id", { count: "exact", head: true }).eq("application_id", a.id);
    if (!count) await db.from("followups").insert({ user_id: ctx.userId, application_id: a.id, due_at: new Date(a.follow_up_date).toISOString(), type: "follow_up" });
  }
  const soon = new Date(now.getTime() + 24 * 3600_000).toISOString();
  const { data: iv } = await db.from("interviews").select("id, scheduled_at, round, details, applications!inner(job_id, jobs!inner(title, company))").eq("user_id", ctx.userId).eq("status", "scheduled").gte("scheduled_at", now.toISOString()).lte("scheduled_at", soon);
  for (const i of (iv ?? []) as unknown as { id: string; scheduled_at: string; round: number; details: { reminded?: boolean }; applications: { job_id: string; jobs: { title: string; company: string } } }[]) {
    if (i.details?.reminded) continue;
    await notify(db, ctx.userId, ctx.settings, { type: "interview", title: `Interview within 24h: ${i.applications.jobs.company} (round ${i.round})`, content: new Date(i.scheduled_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), link: "/interviews" }, { telegramToken });
    await db.from("interviews").update({ details: { ...(i.details ?? {}), reminded: true } }).eq("id", i.id);
    notified++;
  }
  // expire postings past deadline that were never applied to
  const { data: expired } = await db.from("jobs").select("id").eq("user_id", ctx.userId).lt("deadline", today);
  let expiredCount = 0;
  for (const j of expired ?? []) {
    const { data: ap } = await db.from("applications").select("id, application_status").eq("job_id", j.id).maybeSingle();
    if (ap && ["discovered", "saved", "shortlisted", "resume_generated", "ready_to_apply"].includes(ap.application_status)) {
      await setApplicationStatus(db, ctx.userId, j.id, "expired", { by: "agent", note: "Application deadline passed" });
      expiredCount++;
    }
  }
  return { notified, expired: expiredCount };
}

export async function scheduleDueSearches(db: DB, userId?: string) {
  let q = db.from("saved_searches").select("id, user_id, name").eq("enabled", true).neq("schedule", "manual").lte("next_run_at", new Date().toISOString());
  if (userId) q = q.eq("user_id", userId);
  const { data } = await q;
  const queued: string[] = [];
  for (const s of data ?? []) {
    const r = await enqueue(db, s.user_id, "search", { savedSearchId: s.id, dedupe: false });
    // move next_run_at immediately so a second tick doesn't double-queue; the task sets the precise value
    await db.from("saved_searches").update({ next_run_at: new Date(Date.now() + 3600_000).toISOString() }).eq("id", s.id);
    queued.push(r.id);
  }
  return queued;
}

export type { TailoredResume };
