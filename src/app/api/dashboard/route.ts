import { route } from "@/lib/api";
import { APPLIED_SET, everApplied, everResponded, pct, type AppLite } from "@/lib/stats";
import { shapeJob, JOB_LIST_COLUMNS } from "@/lib/jobs-query";

export const GET = route(async (c) => {
  const ctx = await c.context();
  const moderate = ctx.settings.scoring.thresholds.moderate;
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const today = since.toISOString();
  const [jobsR, appsR, eventsR, tasksR, fuR, ivR, recR] = await Promise.all([
    c.db.from("jobs").select("id, match_score, discovered_at, duplicate_of, hidden").eq("user_id", c.userId),
    c.db.from("applications").select("id, job_id, application_status, applied_at, created_at, updated_at, follow_up_date, resume_version_id, status_history, jobs(title, company, source, match_score)").eq("user_id", c.userId),
    c.db.from("agent_events").select("id, kind, message, created_at, data").eq("user_id", c.userId).order("created_at", { ascending: false }).limit(15),
    c.db.from("agent_tasks").select("id, task_type, status, created_at, started_at, error, jobs(title, company)").eq("user_id", c.userId).in("status", ["pending", "running", "waiting_user"]).order("created_at", { ascending: false }).limit(20),
    c.db.from("followups").select("id, due_at, type, note, application_id, applications(job_id, jobs(title, company))").eq("user_id", c.userId).eq("status", "pending").order("due_at").limit(10),
    c.db.from("interviews").select("id, scheduled_at, status").eq("user_id", c.userId).eq("status", "scheduled"),
    c.db.from("jobs").select(JOB_LIST_COLUMNS).eq("user_id", c.userId).eq("hidden", false).is("duplicate_of", null).gte("discovered_at", new Date(Date.now() - 7 * 864e5).toISOString()).order("match_score", { ascending: false }).limit(40),
  ]);
  const jobs = (jobsR.data ?? []).filter((j) => !j.duplicate_of);
  const apps = (appsR.data ?? []) as unknown as AppLite[];
  const st = (s: string[]) => apps.filter((a) => s.includes(a.application_status)).length;
  const applied = apps.filter(everApplied);
  const responded = applied.filter(everResponded);
  const interviewsOrBetter = applied.filter((a) => (a.status_history ?? []).some((h) => ["interview", "offer"].includes(h.to)));
  const todayApps = apps.filter((a) => (a.applied_at ?? "") >= today);
  const todayResponses = apps.filter((a) => (a.status_history ?? []).some((h) => h.at >= today && ["recruiter_contacted", "interview", "assessment", "offer", "rejected"].includes(h.to)));
  const waitingTasks = (tasksR.data ?? []).filter((t) => t.status === "waiting_user");
  const dueFollowups = (fuR.data ?? []).filter((f) => f.due_at <= new Date().toISOString());
  const recommended = ((recR.data ?? []) as never[]).map(shapeJob).filter((j) => !j.application || ["discovered", "saved", "shortlisted", "resume_generated", "ready_to_apply"].includes(j.application.application_status)).filter((j) => (j.match_score ?? 0) >= moderate).slice(0, 6);

  return {
    stats: {
      total_jobs: jobs.length,
      new_today: jobs.filter((j) => j.discovered_at >= today).length,
      matching: jobs.filter((j) => (j.match_score ?? 0) >= moderate).length,
      shortlisted: st(["shortlisted", "saved"]),
      applied: applied.length,
      pending: st(["resume_generated", "ready_to_apply", "awaiting_approval"]),
      interviews: st(["interview"]),
      interviews_scheduled: (ivR.data ?? []).filter((i) => i.scheduled_at && i.scheduled_at >= new Date().toISOString()).length,
      assessments: st(["assessment"]),
      offers: st(["offer"]),
      rejections: st(["rejected"]),
      response_rate: pct(responded.length, applied.length),
      success_rate: pct(interviewsOrBetter.length, applied.length),
      awaiting_approval: st(["awaiting_approval"]),
    },
    pipeline: [
      { key: "discovered", label: "Discovered", count: jobs.length },
      { key: "matched", label: "Matched", count: jobs.filter((j) => (j.match_score ?? 0) >= moderate).length },
      { key: "shortlisted", label: "Shortlisted", count: st(["shortlisted", "saved"]) },
      { key: "resume_ready", label: "Resume Ready", count: st(["resume_generated", "ready_to_apply"]) },
      { key: "awaiting_approval", label: "Awaiting Approval", count: st(["awaiting_approval"]) },
      { key: "applied", label: "Applied", count: st(APPLIED_SET.filter((s) => !["interview", "offer", "rejected", "withdrawn", "assessment"].includes(s))) },
      { key: "interview", label: "Interview", count: st(["interview", "assessment"]) },
      { key: "offer", label: "Offer", count: st(["offer"]) },
    ],
    recommended,
    agent: { tasks: tasksR.data ?? [] },
    activity: eventsR.data ?? [],
    daily: {
      jobs_found: jobs.filter((j) => j.discovered_at >= today).length,
      matches: jobs.filter((j) => j.discovered_at >= today && (j.match_score ?? 0) >= moderate).length,
      applications: todayApps.length,
      responses: todayResponses.length,
      actions_required: st(["awaiting_approval"]) + waitingTasks.length + dueFollowups.length,
      actions: [
        ...(st(["awaiting_approval"]) ? [{ label: `${st(["awaiting_approval"])} application(s) awaiting your approval`, href: "/queue" }] : []),
        ...waitingTasks.map((t) => ({ label: `Agent needs you: ${t.error ?? t.task_type}`, href: "/activity" })),
        ...(dueFollowups.length ? [{ label: `${dueFollowups.length} follow-up(s) due`, href: "/applications" }] : []),
        ...(!ctx.hasProfile ? [{ label: "Upload your resume to enable matching", href: "/resume" }] : []),
      ],
    },
    followups: fuR.data ?? [],
    has_profile: ctx.hasProfile,
  };
});
