import { body, check, HttpError, route } from "@/lib/api";
import { nextRunAt } from "@/lib/agent/pipeline";

export const PATCH = route<{ id: string }>(async (c, req, { id }) => {
  const b = await body<Record<string, unknown>>(req);
  const allowed = ["name", "query", "filters", "sources", "schedule", "cron", "enabled"];
  const patch = Object.fromEntries(Object.entries(b).filter(([k]) => allowed.includes(k)));
  if (patch.schedule && !["manual", "6h", "12h", "daily", "weekly", "custom"].includes(String(patch.schedule))) throw new HttpError(400, "invalid schedule");
  if ("schedule" in patch || "cron" in patch || patch.enabled === true) {
    const cur = check(await c.db.from("saved_searches").select("schedule, cron").eq("id", id).eq("user_id", c.userId).maybeSingle());
    const sched = String(patch.schedule ?? cur?.schedule ?? "manual");
    patch.next_run_at = nextRunAt(sched, (patch.cron as string) ?? cur?.cron) ? new Date().toISOString() : null;
  }
  return check(await c.db.from("saved_searches").update(patch).eq("id", id).eq("user_id", c.userId).select("*").single());
});

export const DELETE = route<{ id: string }>(async (c, _req, { id }) => {
  check(await c.db.from("saved_searches").delete().eq("id", id).eq("user_id", c.userId));
  return { ok: true };
});
