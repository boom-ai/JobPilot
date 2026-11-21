import { NextResponse } from "next/server";
import { adminClient, isLocalMode, type DB } from "@/lib/supabase/clients";
import { localDb } from "@/lib/supabase/localdb";
import { processTasks } from "@/lib/agent/runner";
import { requeueStale, enqueue } from "@/lib/agent/queue";
import { scheduleDueSearches } from "@/lib/agent/services";

export const maxDuration = 60;

/**
 * Called by Vercel Cron (or any scheduler) with `Authorization: Bearer $CRON_SECRET`.
 * Queues due saved searches + daily status monitoring, then processes non-browser tasks within the time budget.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!isLocalMode() && (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db: DB = isLocalMode() ? (localDb() as unknown as DB) : adminClient();
  await requeueStale(db);
  const searches = await scheduleDueSearches(db);
  // one status-monitoring pass per user per run
  const { data: users } = await db.from("user_profiles").select("user_id");
  for (const u of users ?? []) {
    const { count } = await db.from("agent_tasks").select("id", { count: "exact", head: true }).eq("user_id", u.user_id).eq("task_type", "status_monitoring").eq("status", "pending");
    if (!count) await enqueue(db, u.user_id, "status_monitoring", { dedupe: false });
  }
  const r = await processTasks(db, { workerId: "cron", limit: 10, secretsDb: db, deadlineMs: 45_000 });
  return NextResponse.json({ queued_searches: searches.length, ...r });
}
