import { body, check, HttpError, must, route } from "@/lib/api";
import { setApplicationStatus } from "@/lib/agent/records";
import { APPLICATION_STATUSES, type ApplicationStatus } from "@/lib/types";
import { enqueue } from "@/lib/agent/queue";
import { logEvent } from "@/lib/agent/events";

export const PATCH = route<{ id: string }>(async (c, req, { id }) => {
  const b = await body<{ status?: ApplicationStatus; note?: string; notes?: string; follow_up_date?: string | null; recruiter_details?: object; offer_details?: object }>(req);
  const app = must(check(await c.db.from("applications").select("id, job_id").eq("user_id", c.userId).eq("id", id).maybeSingle()), "Application not found");
  const extra: Record<string, unknown> = {};
  if (b.notes !== undefined) extra.notes = String(b.notes).slice(0, 10000);
  if (b.follow_up_date !== undefined) extra.follow_up_date = b.follow_up_date || null;
  if (b.recruiter_details !== undefined) extra.recruiter_details = b.recruiter_details;
  if (b.offer_details !== undefined) extra.offer_details = b.offer_details;
  if (b.status) {
    if (!APPLICATION_STATUSES.includes(b.status)) throw new HttpError(400, "invalid status");
    return setApplicationStatus(c.db, c.userId, app.job_id, b.status, { note: b.note, by: "user", extra });
  }
  check(await c.db.from("applications").update(extra).eq("id", id).eq("user_id", c.userId));
  if (b.follow_up_date) {
    await c.db.from("followups").delete().eq("application_id", id).eq("status", "pending");
    await c.db.from("followups").insert({ user_id: c.userId, application_id: id, due_at: new Date(b.follow_up_date).toISOString(), type: "follow_up" });
  }
  return { ok: true };
});

/** Approve or reject an application that is awaiting approval (assisted / 80–89 band). */
export const POST = route<{ id: string }>(async (c, req, { id }) => {
  const b = await body<{ action: "approve" | "reject" | "approve_declarations" }>(req);
  const app = must(check(await c.db.from("applications").select("id, job_id, application_status, review_data, jobs(title, company)").eq("user_id", c.userId).eq("id", id).maybeSingle()), "Application not found");
  const job = (Array.isArray(app.jobs) ? app.jobs[0] : app.jobs) as { title: string; company: string };
  if (b.action === "reject") {
    await setApplicationStatus(c.db, c.userId, app.job_id, "ready_to_apply", { note: "Submission declined by user — apply manually if you change your mind" });
    await c.db.from("agent_tasks").update({ status: "cancelled", error: "Declined by user" }).eq("user_id", c.userId).eq("job_id", app.job_id).eq("task_type", "application_submission").in("status", ["pending", "waiting_user"]);
    return { ok: true };
  }
  if (app.application_status !== "awaiting_approval") throw new HttpError(409, "This application is not awaiting approval.");
  // close any waiting task and enqueue an approved submission (handled by the local browser worker)
  await c.db.from("agent_tasks").update({ status: "completed", error: null }).eq("user_id", c.userId).eq("job_id", app.job_id).eq("task_type", "application_submission").eq("status", "waiting_user");
  const t = await enqueue(c.db, c.userId, "application_submission", { jobId: app.job_id, requiresBrowser: true, dedupe: false, payload: { approved: true, autoSubmit: true, approveDeclarations: b.action === "approve_declarations", review: app.review_data } });
  await logEvent(c.db, c.userId, "application_approved", `You approved submission: ${job.title} — ${job.company}`, { job_id: app.job_id, task_id: t.id });
  return { ok: true, task_id: t.id };
});

export const DELETE = route<{ id: string }>(async (c, _req, { id }) => {
  check(await c.db.from("applications").delete().eq("id", id).eq("user_id", c.userId));
  return { ok: true };
});
