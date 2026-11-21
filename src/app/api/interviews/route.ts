import { body, check, HttpError, route } from "@/lib/api";
import { setApplicationStatus } from "@/lib/agent/records";
import { logEvent } from "@/lib/agent/events";

export const GET = route(async (c) => ({
  interviews: check(await c.db.from("interviews").select("*, applications(id, job_id, application_status, jobs(id, title, company, description))").eq("user_id", c.userId).order("scheduled_at", { ascending: true })),
}));

export const POST = route(async (c, req) => {
  const b = await body<{ application_id?: string; job_id?: string; scheduled_at?: string; round?: number; interview_type?: string; details?: object; notes?: string }>(req);
  let appId = b.application_id;
  if (!appId && b.job_id) appId = (await setApplicationStatus(c.db, c.userId, b.job_id, "interview", { note: "Interview scheduled" })).id;
  if (!appId) throw new HttpError(400, "application_id or job_id required");
  const app = check(await c.db.from("applications").select("job_id, application_status").eq("id", appId).eq("user_id", c.userId).single());
  if (!["interview", "offer"].includes(app.application_status)) await setApplicationStatus(c.db, c.userId, app.job_id, "interview", { note: "Interview scheduled" });
  const row = check(await c.db.from("interviews").insert({ user_id: c.userId, application_id: appId, scheduled_at: b.scheduled_at ?? null, round: b.round ?? 1, interview_type: b.interview_type ?? null, details: b.details ?? {}, notes: b.notes ?? null }).select("*").single());
  await logEvent(c.db, c.userId, "interview_scheduled", `Interview round ${row.round} added`, { application_id: appId });
  return row;
});
