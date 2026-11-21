// Task runner used by the API ("Run now"), the cron route, and the local worker.
import type { DB } from "../supabase/clients";
import { loadUserContext, type UserContext } from "./context";
import { claimTasks, failTask, finishTask, TaskLogger, waitForUser, type AgentTask } from "./queue";
import { runSearchPipeline, nextRunAt, type SavedSearchRow } from "./pipeline";
import { analyzeJob, createAnswers, createLetter, createTailoredResume, monitorStatus, prepareApplication } from "./services";
import { logEvent, notify } from "./events";
import { decryptSecret } from "../crypto";

export type BrowserHandler = (db: DB, ctx: UserContext, task: AgentTask, logger: TaskLogger) => Promise<{ status: "completed" | "waiting_user"; result: Record<string, unknown>; reason?: string }>;

export interface RunOptions {
  workerId: string;
  limit?: number;
  userId?: string;
  allowBrowser?: boolean;
  browserHandler?: BrowserHandler;
  /** db used to read encrypted secrets (service role); defaults to `db` */
  secretsDb?: DB | null;
  fetchImpl?: typeof fetch;
  deadlineMs?: number;
}

export async function telegramTokenFor(secretsDb: DB | null | undefined, userId: string): Promise<string | null> {
  if (!secretsDb) return null;
  const { data } = await secretsDb.from("user_secrets").select("telegram_bot_token_enc").eq("user_id", userId).maybeSingle();
  try {
    return decryptSecret(data?.telegram_bot_token_enc ?? null);
  } catch {
    return null;
  }
}

export async function processTasks(db: DB, opts: RunOptions): Promise<{ processed: { id: string; type: string; status: string; error?: string }[] }> {
  const started = Date.now();
  const tasks = await claimTasks(db, { workerId: opts.workerId, limit: opts.limit ?? 5, userId: opts.userId, allowBrowser: !!opts.allowBrowser });
  const processed: { id: string; type: string; status: string; error?: string }[] = [];
  const ctxCache = new Map<string, UserContext>();
  for (const task of tasks) {
    if (opts.deadlineMs && Date.now() - started > opts.deadlineMs) {
      // out of time budget: release the task back to the queue
      await db.from("agent_tasks").update({ status: "pending", locked_by: null }).eq("id", task.id);
      continue;
    }
    const logger = new TaskLogger(db, task);
    try {
      let ctx = ctxCache.get(task.user_id);
      if (!ctx) {
        ctx = await loadUserContext(db, task.user_id, opts.secretsDb === undefined ? db : opts.secretsDb);
        ctxCache.set(task.user_id, ctx);
      }
      await logger.log(`Started ${task.task_type}${task.retry_count ? ` (retry ${task.retry_count})` : ""}`, true);
      const outcome = await runOne(db, ctx, task, logger, opts);
      if (outcome.status === "waiting_user") await waitForUser(db, task, logger, outcome.reason ?? "Waiting for user", outcome.result);
      else await finishTask(db, task, logger, outcome.result);
      processed.push({ id: task.id, type: task.task_type, status: outcome.status });
    } catch (e) {
      const retried = await failTask(db, task, logger, e, { retryable: !/not found|Upload a resume|No AI provider|duplicate/i.test((e as Error).message) });
      processed.push({ id: task.id, type: task.task_type, status: retried ? "retrying" : "failed", error: (e as Error).message });
      if (!retried) {
        const ctx = ctxCache.get(task.user_id);
        await logEvent(db, task.user_id, "task_failed", `${task.task_type.replace(/_/g, " ")} failed: ${(e as Error).message.slice(0, 200)}`, { task_id: task.id }, task.id);
        if (ctx) await notify(db, task.user_id, ctx.settings, { type: "agent_error", title: `Agent task failed: ${task.task_type.replace(/_/g, " ")}`, content: (e as Error).message.slice(0, 300), link: "/activity" });
      }
    }
  }
  return { processed };
}

async function runOne(db: DB, ctx: UserContext, task: AgentTask, logger: TaskLogger, opts: RunOptions): Promise<{ status: "completed" | "waiting_user"; result: Record<string, unknown>; reason?: string }> {
  const jobId = task.job_id;
  const tg = await telegramTokenFor(opts.secretsDb === undefined ? db : opts.secretsDb, task.user_id);
  switch (task.task_type) {
    case "search": {
      let search: SavedSearchRow | null = null;
      if (task.saved_search_id) {
        const { data } = await db.from("saved_searches").select("*").eq("id", task.saved_search_id).maybeSingle();
        search = data as SavedSearchRow | null;
      }
      const r = await runSearchPipeline(db, ctx, search, (m) => logger.log(m), { fetchImpl: opts.fetchImpl, taskId: task.id, telegramToken: tg });
      if (search) {
        const now = new Date();
        await db.from("saved_searches").update({ last_run_at: now.toISOString(), next_run_at: nextRunAt(search.schedule, (search as unknown as { cron?: string }).cron, now) }).eq("id", search.id);
      }
      return { status: "completed", result: { inserted: r.ingest.inserted.length, duplicates: r.ingest.duplicates, excluded: r.ingest.excluded.length, sources: r.sources, queued: r.queued } };
    }
    case "job_analysis": {
      if (!jobId) throw new Error("job_analysis requires a job");
      const r = await analyzeJob(db, ctx, jobId);
      await logger.log(`Score ${r.match?.overall ?? "n/a"}${r.ai ? " + AI analysis" : ""}${r.aiError ? ` (AI error: ${r.aiError})` : ""}`);
      return { status: "completed", result: { score: r.match?.overall ?? null, ai: !!r.ai, ai_error: r.aiError } };
    }
    case "resume_tailoring": {
      if (!jobId) throw new Error("resume_tailoring requires a job");
      const r = await createTailoredResume(db, ctx, jobId, { auto: !!task.payload?.auto });
      await logger.log(`Created ${r.file_name} (v${r.version}, ${r.method}); ${r.issues.length} AI suggestions rejected by truth check`);
      // continue the autonomous flow for qualifying jobs
      if (task.payload?.auto && ctx.settings.automation.mode !== "manual") {
        const { data: job } = await db.from("jobs").select("match_score").eq("id", jobId).single();
        if ((job?.match_score ?? 0) >= ctx.settings.automation.approval_min_score) {
          const { enqueue } = await import("./queue");
          await enqueue(db, ctx.userId, "application_preparation", { jobId });
          await logger.log("Queued application preparation");
        }
      }
      return { status: "completed", result: { version_id: r.id, version: r.version, method: r.method, rejected: r.issues.length } };
    }
    case "cover_letter": {
      if (!jobId) throw new Error("cover_letter requires a job");
      const r = await createLetter(db, ctx, jobId, (task.payload?.kind as never) ?? "cover_letter", (task.payload?.tone as string) ?? "professional");
      return { status: "completed", result: { id: r.id } };
    }
    case "application_preparation": {
      if (!jobId) throw new Error("application_preparation requires a job");
      if (task.payload?.answers_only) {
        const a = await createAnswers(db, ctx, jobId);
        return { status: "completed", result: { answers: a.length } };
      }
      const r = await prepareApplication(db, ctx, jobId, { by: "agent" });
      await logger.log(`Routed: ${r.route}${"reason" in r && r.reason ? ` — ${r.reason}` : ""}`);
      return { status: "completed", result: r as unknown as Record<string, unknown> };
    }
    case "application_submission": {
      if (!opts.browserHandler) throw new Error("Browser automation runs only in the local worker (npm run worker).");
      return opts.browserHandler(db, ctx, task, logger);
    }
    case "status_monitoring": {
      const r = await monitorStatus(db, ctx, tg);
      await logger.log(`Notifications sent: ${r.notified}; postings expired: ${r.expired}`);
      return { status: "completed", result: r };
    }
    case "notification": {
      await notify(db, ctx.userId, ctx.settings, { type: (task.payload?.type as never) ?? "application", title: String(task.payload?.title ?? "Notification"), content: task.payload?.content as string | undefined, link: task.payload?.link as string | undefined }, { telegramToken: tg });
      return { status: "completed", result: {} };
    }
  }
}
