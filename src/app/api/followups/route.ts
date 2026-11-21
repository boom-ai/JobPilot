import { body, check, HttpError, route } from "@/lib/api";

export const GET = route(async (c) => ({
  followups: check(await c.db.from("followups").select("*, applications(id, job_id, application_status, jobs(title, company))").eq("user_id", c.userId).order("due_at")),
}));

export const PATCH = route(async (c, req) => {
  const b = await body<{ id: string; status: "done" | "skipped" | "pending"; due_at?: string }>(req);
  if (!b.id) throw new HttpError(400, "id required");
  return check(await c.db.from("followups").update({ status: b.status, ...(b.due_at ? { due_at: b.due_at, notified_at: null } : {}) }).eq("id", b.id).eq("user_id", c.userId).select("*").single());
});
