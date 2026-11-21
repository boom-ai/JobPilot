import { body, check, HttpError, route } from "@/lib/api";
import { nextRunAt } from "@/lib/agent/pipeline";

const SCHEDULES = ["manual", "6h", "12h", "daily", "weekly", "custom"];

export const GET = route(async (c) => ({
  searches: check(await c.db.from("saved_searches").select("*").eq("user_id", c.userId).order("created_at", { ascending: true })),
}));

export const POST = route(async (c, req) => {
  const b = await body<{ name: string; query?: object; filters?: object; sources?: string[]; schedule?: string; cron?: string; clone_of?: string }>(req);
  let base: Record<string, unknown> = {};
  if (b.clone_of) {
    base = check(await c.db.from("saved_searches").select("query, filters, sources, schedule, cron").eq("user_id", c.userId).eq("id", b.clone_of).maybeSingle()) ?? {};
  }
  if (!b.name?.trim()) throw new HttpError(400, "name required");
  const schedule = b.schedule ?? (base.schedule as string) ?? "manual";
  if (!SCHEDULES.includes(schedule)) throw new HttpError(400, "invalid schedule");
  return check(
    await c.db
      .from("saved_searches")
      .insert({ user_id: c.userId, name: b.name.trim().slice(0, 80), query: b.query ?? base.query ?? {}, filters: b.filters ?? base.filters ?? {}, sources: b.sources ?? base.sources ?? [], schedule, cron: b.cron ?? base.cron ?? null, enabled: true, next_run_at: nextRunAt(schedule, b.cron) ? new Date().toISOString() : null })
      .select("*")
      .single(),
  );
});
