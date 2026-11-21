import { body, check, HttpError, route } from "@/lib/api";
import { agentState, enqueue, setAgentState } from "@/lib/agent/queue";
import { processTasks } from "@/lib/agent/runner";
import { logEvent } from "@/lib/agent/events";
import { scheduleDueSearches } from "@/lib/agent/services";

export const GET = route(async (c, req) => {
  const u = new URL(req.url);
  const limit = Math.min(200, parseInt(u.searchParams.get("limit") ?? "60"));
  const [tasks, events, counts] = await Promise.all([
    c.db.from("agent_tasks").select("id, task_type, status, job_id, saved_search_id, error, retry_count, logs, result, requires_browser, created_at, started_at, finished_at, run_after, jobs(title, company)").eq("user_id", c.userId).order("created_at", { ascending: false }).limit(limit),
    c.db.from("agent_events").select("*").eq("user_id", c.userId).order("created_at", { ascending: false }).limit(limit),
    c.db.from("agent_tasks").select("status").eq("user_id", c.userId).in("status", ["pending", "running", "waiting_user"]),
  ]);
  const byStatus: Record<string, number> = {};
  for (const t of counts.data ?? []) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  const running = (tasks.data ?? []).find((t) => t.status === "running");
  return { state: await agentState(c.db, c.userId), tasks: tasks.data ?? [], events: events.data ?? [], queue: byStatus, current: running ?? null };
});

/** Controls: start | pause | resume | stop | run_now | search_now | monitor_now */
export const POST = route(async (c, req) => {
  const b = await body<{ action: string }>(req);
  switch (b.action) {
    case "start":
    case "resume":
      await setAgentState(c.db, c.userId, "running");
      await logEvent(c.db, c.userId, "agent_state", "Agent resumed");
      return { state: "running" };
    case "pause":
      await setAgentState(c.db, c.userId, "paused");
      await logEvent(c.db, c.userId, "agent_state", "Agent paused — queued tasks will wait");
      return { state: "paused" };
    case "stop":
      await setAgentState(c.db, c.userId, "stopped");
      await logEvent(c.db, c.userId, "agent_state", "EMERGENCY STOP — all queued and running tasks cancelled");
      return { state: "stopped" };
    case "run_now": {
      if ((await agentState(c.db, c.userId)) !== "running") throw new HttpError(409, "Agent is paused or stopped. Resume it first.");
      await scheduleDueSearches(c.db, c.userId);
      const r = await processTasks(c.db, { workerId: "web", limit: 8, userId: c.userId, secretsDb: c.secretsDb, deadlineMs: 50_000 });
      return r;
    }
    case "search_now": {
      const t = await enqueue(c.db, c.userId, "search", { dedupe: false });
      const r = await processTasks(c.db, { workerId: "web", limit: 1, userId: c.userId, secretsDb: c.secretsDb, deadlineMs: 50_000 });
      return { task_id: t.id, ...r };
    }
    case "monitor_now": {
      await enqueue(c.db, c.userId, "status_monitoring");
      return processTasks(c.db, { workerId: "web", limit: 1, userId: c.userId, secretsDb: c.secretsDb });
    }
    case "clear_finished":
      check(await c.db.from("agent_tasks").delete().eq("user_id", c.userId).in("status", ["completed", "cancelled"]));
      return { ok: true };
    default:
      throw new HttpError(400, "unknown action");
  }
});
