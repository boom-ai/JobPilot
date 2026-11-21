import { route } from "@/lib/api";
import { enqueue } from "@/lib/agent/queue";
import { processTasks } from "@/lib/agent/runner";

/** Queue the saved search and run it now (within this request). */
export const POST = route<{ id: string }>(async (c, _req, { id }) => {
  const t = await enqueue(c.db, c.userId, "search", { savedSearchId: id, dedupe: false });
  const r = await processTasks(c.db, { workerId: "web", limit: 1, userId: c.userId, secretsDb: c.secretsDb, deadlineMs: 50_000 });
  const { data } = await c.db.from("agent_tasks").select("status, result, error, logs").eq("id", t.id).single();
  return { task_id: t.id, processed: r.processed, task: data };
});
