// Task queue on top of the agent_tasks table.
import type { DB } from "../supabase/clients";

export type TaskType =
  | "search" | "job_analysis" | "resume_tailoring" | "cover_letter" | "application_preparation"
  | "application_submission" | "status_monitoring" | "notification";

export type TaskStatus = "pending" | "running" | "waiting_user" | "completed" | "failed" | "cancelled";

export interface AgentTask {
  id: string;
  user_id: string;
  job_id: string | null;
  saved_search_id: string | null;
  task_type: TaskType;
  status: TaskStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  logs: { at: string; msg: string }[];
  error: string | null;
  retry_count: number;
  max_retries: number;
  requires_browser: boolean;
  run_after: string;
  created_at: string;
}

export async function enqueue(
  db: DB,
  userId: string,
  type: TaskType,
  opts: { jobId?: string | null; savedSearchId?: string | null; payload?: Record<string, unknown>; requiresBrowser?: boolean; dedupe?: boolean; runAfter?: Date } = {},
): Promise<{ id: string; existing: boolean }> {
  if (opts.dedupe !== false && opts.jobId) {
    const { data: dup } = await db
      .from("agent_tasks")
      .select("id")
      .eq("user_id", userId)
      .eq("task_type", type)
      .eq("job_id", opts.jobId)
      .in("status", ["pending", "running", "waiting_user"])
      .limit(1);
    if (dup?.length) return { id: dup[0].id, existing: true };
  }
  const { data, error } = await db
    .from("agent_tasks")
    .insert({
      user_id: userId,
      task_type: type,
      job_id: opts.jobId ?? null,
      saved_search_id: opts.savedSearchId ?? null,
      payload: opts.payload ?? {},
      requires_browser: opts.requiresBrowser ?? type === "application_submission",
      run_after: (opts.runAfter ?? new Date()).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`enqueue failed: ${error.message}`);
  return { id: data.id, existing: false };
}

export async function agentState(db: DB, userId: string): Promise<"running" | "paused" | "stopped"> {
  const { data } = await db.from("agent_state").select("state").eq("user_id", userId).maybeSingle();
  return (data?.state as "running" | "paused" | "stopped") ?? "running";
}

export async function setAgentState(db: DB, userId: string, state: "running" | "paused" | "stopped") {
  await db.from("agent_state").upsert({ user_id: userId, state, updated_at: new Date().toISOString() });
  if (state === "stopped") {
    // Emergency stop: cancel everything queued or in flight.
    await db
      .from("agent_tasks")
      .update({ status: "cancelled", error: "Stopped by user (emergency stop)", finished_at: new Date().toISOString() })
      .eq("user_id", userId)
      .in("status", ["pending", "running", "waiting_user"]);
  }
}

/** Atomically claim due tasks. Only one worker can move a task from pending → running. */
export async function claimTasks(
  db: DB,
  opts: { workerId: string; limit: number; userId?: string; allowBrowser: boolean; types?: TaskType[] },
): Promise<AgentTask[]> {
  let q = db.from("agent_tasks").select("*").eq("status", "pending").lte("run_after", new Date().toISOString()).order("created_at", { ascending: true }).limit(opts.limit * 3);
  if (opts.userId) q = q.eq("user_id", opts.userId);
  if (!opts.allowBrowser) q = q.eq("requires_browser", false);
  if (opts.types?.length) q = q.in("task_type", opts.types);
  const { data, error } = await q;
  if (error) throw new Error(`claim query failed: ${error.message}`);
  const claimed: AgentTask[] = [];
  const stateCache = new Map<string, string>();
  for (const t of (data ?? []) as AgentTask[]) {
    if (claimed.length >= opts.limit) break;
    if (!stateCache.has(t.user_id)) stateCache.set(t.user_id, await agentState(db, t.user_id));
    if (stateCache.get(t.user_id) !== "running") continue; // paused or stopped
    const { data: upd } = await db
      .from("agent_tasks")
      .update({ status: "running", locked_by: opts.workerId, started_at: new Date().toISOString() })
      .eq("id", t.id)
      .eq("status", "pending")
      .select("*");
    if (upd?.length) claimed.push(upd[0] as AgentTask);
  }
  return claimed;
}

export class TaskLogger {
  logs: { at: string; msg: string }[];
  constructor(private db: DB, private task: AgentTask) {
    this.logs = [...(task.logs ?? [])];
  }
  async log(msg: string, flush = false) {
    this.logs.push({ at: new Date().toISOString(), msg });
    if (flush) await this.db.from("agent_tasks").update({ logs: this.logs }).eq("id", this.task.id);
  }
}

export async function finishTask(db: DB, task: AgentTask, logger: TaskLogger, result: Record<string, unknown>) {
  await db.from("agent_tasks").update({ status: "completed", result, logs: logger.logs, finished_at: new Date().toISOString(), error: null }).eq("id", task.id).eq("status", "running");
}

export async function waitForUser(db: DB, task: AgentTask, logger: TaskLogger, reason: string, result: Record<string, unknown> = {}) {
  await logger.log(reason);
  await db.from("agent_tasks").update({ status: "waiting_user", result, logs: logger.logs, error: reason }).eq("id", task.id);
}

export async function failTask(db: DB, task: AgentTask, logger: TaskLogger, err: unknown, opts: { retryable?: boolean } = {}) {
  const message = err instanceof Error ? err.message : String(err);
  await logger.log(`Error: ${message}`);
  const canRetry = opts.retryable !== false && task.retry_count < task.max_retries;
  if (canRetry) {
    const delayMin = 2 ** task.retry_count * 5; // 5, 10, 20 min
    await db
      .from("agent_tasks")
      .update({ status: "pending", retry_count: task.retry_count + 1, error: message, logs: logger.logs, locked_by: null, run_after: new Date(Date.now() + delayMin * 60_000).toISOString() })
      .eq("id", task.id);
  } else {
    await db.from("agent_tasks").update({ status: "failed", error: message, logs: logger.logs, finished_at: new Date().toISOString() }).eq("id", task.id);
  }
  return canRetry;
}

export async function isCancelled(db: DB, taskId: string): Promise<boolean> {
  const { data } = await db.from("agent_tasks").select("status").eq("id", taskId).maybeSingle();
  return data?.status === "cancelled";
}

/** Recover tasks left "running" by a crashed worker. */
export async function requeueStale(db: DB, olderThanMinutes = 20) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  await db.from("agent_tasks").update({ status: "pending", locked_by: null }).eq("status", "running").lt("started_at", cutoff).eq("requires_browser", false);
}
