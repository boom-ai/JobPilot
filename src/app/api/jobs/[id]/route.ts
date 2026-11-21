import { body, check, HttpError, must, route } from "@/lib/api";
import { setApplicationStatus } from "@/lib/agent/records";
import { APPLICATION_STATUSES, type ApplicationStatus } from "@/lib/types";
import { logEvent } from "@/lib/agent/events";
import { normalizeCompany } from "@/lib/text";
import { supportedAts } from "@/lib/agent/services";

export const GET = route<{ id: string }>(async (c, _req, { id }) => {
  const job = must(check(await c.db.from("jobs").select("*").eq("user_id", c.userId).eq("id", id).maybeSingle()), "Job not found");
  const [app, versions, letters, answers, sources, tasks, company, dups] = await Promise.all([
    c.db.from("applications").select("*").eq("user_id", c.userId).eq("job_id", id).maybeSingle(),
    c.db.from("resume_versions").select("id, version, file_name, method, created_at, updated_at, change_log").eq("user_id", c.userId).eq("job_id", id).order("version", { ascending: false }),
    c.db.from("cover_letters").select("*").eq("user_id", c.userId).eq("job_id", id).order("created_at", { ascending: false }),
    c.db.from("application_answers").select("*").eq("user_id", c.userId).eq("job_id", id).order("created_at", { ascending: true }),
    c.db.from("job_sources").select("source_name, source_url, created_at").eq("job_id", id),
    c.db.from("agent_tasks").select("id, task_type, status, error, created_at").eq("user_id", c.userId).eq("job_id", id).order("created_at", { ascending: false }).limit(10),
    c.db.from("companies").select("*").eq("user_id", c.userId).eq("normalized_name", normalizeCompany((job as { company: string }).company)).maybeSingle(),
    c.db.from("jobs").select("id, title, company, source, source_url").eq("user_id", c.userId).eq("duplicate_of", id),
  ]);
  return {
    job,
    application: app.data,
    resume_versions: versions.data ?? [],
    letters: letters.data ?? [],
    answers: answers.data ?? [],
    sources: sources.data ?? [],
    tasks: tasks.data ?? [],
    company: company.data,
    merged_duplicates: dups.data ?? [],
    ats: supportedAts((job as { apply_url?: string }).apply_url ?? (job as { source_url?: string }).source_url),
  };
});

/** Actions: save | shortlist | hide | unhide | status */
export const PATCH = route<{ id: string }>(async (c, req, { id }) => {
  const b = await body<{ action: string; status?: ApplicationStatus; note?: string }>(req);
  const job = must(check(await c.db.from("jobs").select("id, title, company").eq("user_id", c.userId).eq("id", id).maybeSingle()), "Job not found");
  switch (b.action) {
    case "hide":
    case "unhide":
      check(await c.db.from("jobs").update({ hidden: b.action === "hide" }).eq("id", id).eq("user_id", c.userId));
      return { ok: true };
    case "save":
      return setApplicationStatus(c.db, c.userId, id, "saved", { onlyForward: true });
    case "shortlist": {
      const r = await setApplicationStatus(c.db, c.userId, id, "shortlisted", { onlyForward: true });
      await logEvent(c.db, c.userId, "shortlisted", `Shortlisted ${job.title} — ${job.company}`, { job_id: id });
      return r;
    }
    case "unshortlist":
      return setApplicationStatus(c.db, c.userId, id, "discovered", { note: "Removed from shortlist" });
    case "status": {
      if (!b.status || !APPLICATION_STATUSES.includes(b.status)) throw new HttpError(400, "invalid status");
      // A manual status change is the user's own confirmation (e.g. "I applied myself").
      return setApplicationStatus(c.db, c.userId, id, b.status, { note: b.note, by: "user" });
    }
    default:
      throw new HttpError(400, `unknown action ${b.action}`);
  }
});

export const DELETE = route<{ id: string }>(async (c, _req, { id }) => {
  check(await c.db.from("jobs").delete().eq("id", id).eq("user_id", c.userId));
  return { ok: true };
});
