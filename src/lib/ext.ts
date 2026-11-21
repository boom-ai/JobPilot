// Data the Chrome extension needs to assist on an application page.
import type { DB } from "./supabase/clients";
import type { UserContext } from "./agent/context";
import { canonicalUrl } from "./matching/dedupe";

export async function findJobByUrl(db: DB, userId: string, url: string) {
  const target = canonicalUrl(url);
  if (!target) return null;
  const { data } = await db.from("jobs").select("id, source_url, apply_url").eq("user_id", userId).limit(5000);
  const hit = (data ?? []).find((j) => canonicalUrl(j.source_url) === target || canonicalUrl(j.apply_url) === target || (target.length > 20 && (canonicalUrl(j.apply_url) ?? "").startsWith(target.replace(/\/(apply|application)$/, ""))) || (target.length > 20 && target.startsWith((canonicalUrl(j.source_url) ?? "~~").replace(/\/$/, ""))));
  if (hit) return hit.id as string;
  const { data: src } = await db.from("job_sources").select("job_id, source_url").eq("user_id", userId).limit(5000);
  return ((src ?? []).find((s) => canonicalUrl(s.source_url) === target)?.job_id as string) ?? null;
}

export async function extensionContext(db: DB, ctx: UserContext, jobId: string) {
  const [{ data: job }, { data: app }, { data: versions }, { data: letters }, { data: answers }, { data: lib }] = await Promise.all([
    db.from("jobs").select("id, title, company, location, match_score, match_analysis, source, source_url, apply_url").eq("id", jobId).eq("user_id", ctx.userId).maybeSingle(),
    db.from("applications").select("id, application_status, resume_version_id").eq("job_id", jobId).eq("user_id", ctx.userId).maybeSingle(),
    db.from("resume_versions").select("id, version, file_name").eq("job_id", jobId).eq("user_id", ctx.userId).order("version", { ascending: false }).limit(1),
    db.from("cover_letters").select("id, kind, content").eq("job_id", jobId).eq("user_id", ctx.userId).order("created_at", { ascending: false }),
    db.from("application_answers").select("question, answer, approved, flags").eq("job_id", jobId).eq("user_id", ctx.userId),
    db.from("answer_library").select("key, question, answer, verified").eq("user_id", ctx.userId),
  ]);
  const p = ctx.profile;
  const [first, ...rest] = p.name.split(" ");
  const cur = p.experience[0];
  return {
    job,
    application: app,
    resume: versions?.[0] ?? null,
    cover_letter: letters?.find((l) => l.kind === "cover_letter")?.content ?? null,
    answers: (answers ?? []).filter((a) => a.answer),
    library: (lib ?? []).filter((l) => l.answer && l.verified),
    profile: {
      name: p.name,
      first_name: first ?? "",
      last_name: rest.join(" "),
      email: p.email,
      phone: p.phone,
      location: p.location,
      city: p.location.split(",")[0]?.trim() ?? "",
      linkedin: p.links.find((l) => /linkedin/i.test(l.url))?.url ?? "",
      github: p.links.find((l) => /github/i.test(l.url))?.url ?? "",
      website: p.links.find((l) => !/linkedin|github/i.test(l.url))?.url ?? "",
      current_title: cur?.title ?? "",
      current_company: cur?.company ?? "",
      school: p.education[0]?.institution ?? "",
      degree: p.education[0]?.degree ?? "",
      notice_period: ctx.preferences.notice_period ?? "",
      expected_salary: ctx.preferences.expected_salary ?? "",
      work_authorization: ctx.preferences.work_authorization ?? "",
    },
  };
}
