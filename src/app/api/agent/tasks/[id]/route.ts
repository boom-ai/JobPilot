import { body, check, HttpError, must, route } from "@/lib/api";

/** cancel | retry a single task */
export const POST = route<{ id: string }>(async (c, req, { id }) => {
  const b = await body<{ action: "cancel" | "retry" }>(req);
  const t = must(check(await c.db.from("agent_tasks").select("id, status").eq("user_id", c.userId).eq("id", id).maybeSingle()), "Task not found");
  if (b.action === "cancel") {
    if (!["pending", "running", "waiting_user"].includes(t.status)) throw new HttpError(409, `Task is ${t.status}`);
    check(await c.db.from("agent_tasks").update({ status: "cancelled", error: "Cancelled by user", finished_at: new Date().toISOString() }).eq("id", id));
  } else if (b.action === "retry") {
    if (!["failed", "cancelled", "waiting_user"].includes(t.status)) throw new HttpError(409, `Task is ${t.status}`);
    check(await c.db.from("agent_tasks").update({ status: "pending", error: null, run_after: new Date().toISOString(), locked_by: null }).eq("id", id));
  } else throw new HttpError(400, "unknown action");
  return { ok: true };
});
