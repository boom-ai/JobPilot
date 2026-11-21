// Job ingestion + the scheduled search pipeline.
import type { DB } from "../supabase/clients";
import type { JobFilters, MatchAnalysis, NormalizedJob } from "../types";
import type { UserContext } from "./context";
import { runSources, type SourceRunResult } from "../sources/run";
import { dedupeBatch, findDuplicate, fingerprint, type ExistingJobRef } from "../matching/dedupe";
import { filterJobs } from "../matching/filters";
import { scoreJob } from "../matching/score";
import { jobInsertRow, upsertCompany } from "./records";
import { logEvent, notify } from "./events";
import { enqueue } from "./queue";
import { aiAvailable } from "../ai/provider";
import { DEFAULT_PRESETS } from "../defaults";

export interface IngestResult {
  fetched: number;
  inserted: { id: string; title: string; company: string; score: number | null }[];
  duplicates: number;
  excluded: { title: string; company: string; reason: string }[];
  mergedInto: string[];
}

async function loadExisting(db: DB, userId: string): Promise<ExistingJobRef[]> {
  const since = new Date(Date.now() - 120 * 864e5).toISOString();
  const { data, error } = await db
    .from("jobs")
    .select("id, company, title, location, remote_type, source, source_url, external_job_id, fingerprint, description")
    .eq("user_id", userId)
    .gte("discovered_at", since)
    .order("discovered_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(`load jobs failed: ${error.message}`);
  return (data ?? []) as ExistingJobRef[];
}

export function scoreFor(ctx: UserContext, j: NormalizedJob): MatchAnalysis | null {
  if (!ctx.hasProfile) return null;
  return scoreJob(j, {
    profile: ctx.profile,
    preferences: ctx.preferences,
    weights: ctx.settings.scoring.weights,
    thresholds: ctx.settings.scoring.thresholds,
    usdInr: ctx.settings.sources.exchange_rate_usd_inr,
  });
}

/** Normalize → dedupe → filter → score → store. Shared by searches, manual adds and the extension. */
export async function ingestJobs(
  db: DB,
  ctx: UserContext,
  jobs: NormalizedJob[],
  opts: { filters?: JobFilters; savedSearchId?: string | null; applyPreferenceExclusions?: boolean } = {},
): Promise<IngestResult> {
  const res: IngestResult = { fetched: jobs.length, inserted: [], duplicates: 0, excluded: [], mergedInto: [] };
  const { unique, duplicates: batchDups } = dedupeBatch(jobs);
  res.duplicates += batchDups.length;
  const existing = await loadExisting(db, ctx.userId);

  // Cross-source duplicates of existing jobs: attach the extra source link, don't re-insert.
  const fresh: NormalizedJob[] = [];
  for (const j of unique) {
    const d = findDuplicate(j, existing);
    if (d) {
      res.duplicates++;
      res.mergedInto.push(d.id);
      await db.from("job_sources").upsert(
        { user_id: ctx.userId, job_id: d.id, source_name: j.source, source_url: j.source_url ?? null, external_job_id: j.external_job_id ?? null },
        { onConflict: "job_id,source_name,source_url", ignoreDuplicates: true },
      );
    } else fresh.push(j);
  }
  const filters: JobFilters = {
    ...(opts.filters ?? {}),
    ...(opts.applyPreferenceExclusions !== false
      ? {
          exclude_companies: [...(opts.filters?.exclude_companies ?? []), ...ctx.preferences.exclude_companies],
          exclude_keywords: [...(opts.filters?.exclude_keywords ?? []), ...ctx.preferences.exclude_keywords],
        }
      : {}),
  };
  const scored = fresh.map((j) => ({ ...j, match_score: scoreFor(ctx, j)?.overall ?? null }));
  const { kept, excluded } = filterJobs(scored, filters, { usdInr: ctx.settings.sources.exchange_rate_usd_inr });
  res.excluded = excluded.map((e) => ({ title: e.job.title, company: e.job.company, reason: e.reason }));

  for (const j of kept) {
    const match = scoreFor(ctx, j);
    const companyId = await upsertCompany(db, ctx.userId, j.company);
    const { data, error } = await db.from("jobs").insert(jobInsertRow(ctx.userId, j, { match, companyId, savedSearchId: opts.savedSearchId })).select("id").single();
    if (error) {
      if (/duplicate key/.test(error.message)) {
        res.duplicates++;
        continue;
      }
      throw new Error(`insert job failed: ${error.message}`);
    }
    await db.from("job_sources").insert({ user_id: ctx.userId, job_id: data.id, source_name: j.source, source_url: j.source_url ?? null, external_job_id: j.external_job_id ?? null });
    existing.push({ id: data.id, ...j, fingerprint: fingerprint(j) });
    res.inserted.push({ id: data.id, title: j.title, company: j.company, score: match?.overall ?? null });
  }
  // second source links for in-batch duplicates
  for (const d of batchDups) {
    const target = findDuplicate(d.job, existing);
    if (target)
      await db.from("job_sources").upsert(
        { user_id: ctx.userId, job_id: target.id, source_name: d.job.source, source_url: d.job.source_url ?? null, external_job_id: d.job.external_job_id ?? null },
        { onConflict: "job_id,source_name,source_url", ignoreDuplicates: true },
      );
  }
  return res;
}

export interface SavedSearchRow {
  id: string;
  user_id: string;
  name: string;
  query: { keywords?: string; roles?: string[]; locations?: string[]; exclude?: string[] };
  filters: JobFilters;
  sources: string[];
  schedule: string;
  enabled: boolean;
}

export function queryFromSearch(ctx: UserContext, s: Pick<SavedSearchRow, "query"> | null) {
  const q = s?.query ?? {};
  return {
    keywords: q.keywords ?? ctx.preferences.keywords.slice(0, 6).join(", "),
    roles: q.roles?.length ? q.roles : ctx.preferences.roles,
    locations: q.locations?.length ? q.locations : ctx.preferences.locations,
    exclude: [...(q.exclude ?? []), ...ctx.preferences.exclude_keywords],
    limit: 150,
  };
}

/** The full scheduled-search workflow (spec §15). */
export async function runSearchPipeline(
  db: DB,
  ctx: UserContext,
  search: SavedSearchRow | null,
  log: (m: string) => Promise<void> | void,
  opts: { fetchImpl?: typeof fetch; taskId?: string | null; telegramToken?: string | null } = {},
): Promise<{ ingest: IngestResult; sources: SourceRunResult[]; queued: { analysis: number; tailoring: number } }> {
  const name = search?.name ?? "Preference search";
  const q = queryFromSearch(ctx, search);
  await logEvent(db, ctx.userId, "search_started", `Searching “${name}”`, { sources: search?.sources ?? ctx.settings.sources.enabled }, opts.taskId);
  await log(`Searching "${name}" — keywords: ${q.keywords || "—"}; ${q.roles.length} roles`);
  const { jobs, results } = await runSources(q, ctx.settings, { sources: search?.sources, fetchImpl: opts.fetchImpl });
  for (const r of results) await log(`${r.source}: ${r.ok ? `${r.count} jobs in ${r.ms}ms` : r.skipped ? `skipped (${r.skipped})` : `FAILED — ${r.error}`}${r.logs.length ? ` [${r.logs.join("; ")}]` : ""}`);
  await logEvent(db, ctx.userId, "jobs_retrieved", `Retrieved ${jobs.length} listings from ${results.filter((r) => r.ok).length} sources`, { results }, opts.taskId);
  const failed = results.filter((r) => !r.ok && !r.skipped);
  if (failed.length) await logEvent(db, ctx.userId, "source_errors", `${failed.length} source${failed.length > 1 ? "s" : ""} failed: ${failed.map((f) => f.source).join(", ")}`, { failed }, opts.taskId);

  const ingest = await ingestJobs(db, ctx, jobs, { filters: search?.filters ?? {}, savedSearchId: search?.id ?? null });
  await log(`New: ${ingest.inserted.length}, duplicates: ${ingest.duplicates}, excluded by filters: ${ingest.excluded.length}`);
  if (ingest.duplicates) await logEvent(db, ctx.userId, "duplicates_removed", `${ingest.duplicates} duplicates removed`, {}, opts.taskId);
  if (ingest.excluded.length) {
    const reasons: Record<string, number> = {};
    for (const e of ingest.excluded) reasons[e.reason] = (reasons[e.reason] ?? 0) + 1;
    await logEvent(db, ctx.userId, "jobs_excluded", `${ingest.excluded.length} jobs excluded by filters`, { reasons }, opts.taskId);
  }
  if (ingest.inserted.length) {
    const scored = ingest.inserted.filter((i) => i.score != null);
    await logEvent(db, ctx.userId, "jobs_scored", `${ingest.inserted.length} new jobs added${scored.length ? `, top match ${Math.max(...scored.map((s) => s.score!))}` : ""}`, { inserted: ingest.inserted.slice(0, 50) }, opts.taskId);
  }

  // Notifications for high matches
  const high = ingest.inserted.filter((i) => (i.score ?? 0) >= ctx.settings.notifications.high_match_threshold).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (high.length)
    await notify(db, ctx.userId, ctx.settings, { type: "high_match", title: `${high.length} new high-match job${high.length > 1 ? "s" : ""}`, content: high.slice(0, 5).map((h) => `${h.score} · ${h.title} — ${h.company}`).join("\n"), link: "/matches" }, { telegramToken: opts.telegramToken });
  else if (search && ingest.inserted.length)
    await notify(db, ctx.userId, ctx.settings, { type: "saved_search", title: `“${search.name}”: ${ingest.inserted.length} new jobs`, link: "/discover" }, { telegramToken: opts.telegramToken });

  // Follow-on work
  let analysis = 0;
  let tailoring = 0;
  const top = [...ingest.inserted].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (aiAvailable(ctx.ai) && ctx.settings.ai.use_ai_for_scoring_narrative) {
    for (const j of top.filter((t) => (t.score ?? 0) >= ctx.settings.scoring.thresholds.moderate).slice(0, 10)) {
      await enqueue(db, ctx.userId, "job_analysis", { jobId: j.id });
      analysis++;
    }
  }
  if (ctx.settings.automation.mode !== "manual" || ctx.settings.automation.auto_tailor_min_score > 0) {
    for (const j of top.filter((t) => (t.score ?? 0) >= ctx.settings.automation.auto_tailor_min_score).slice(0, 5)) {
      await enqueue(db, ctx.userId, "resume_tailoring", { jobId: j.id, payload: { auto: true } });
      tailoring++;
    }
  }
  if (analysis || tailoring) await log(`Queued ${analysis} analyses and ${tailoring} resume tailoring tasks`);
  return { ingest, sources: results, queued: { analysis, tailoring } };
}

export function nextRunAt(schedule: string, cron: string | null | undefined, from = new Date()): string | null {
  const h = { "6h": 6, "12h": 12, daily: 24, weekly: 168 }[schedule as "6h"];
  if (h) return new Date(from.getTime() + h * 3600_000).toISOString();
  if (schedule === "custom" && cron) {
    const m = /^every\s+(\d+)\s*(h|hours?|m|min|minutes?)$/i.exec(cron.trim());
    if (m) return new Date(from.getTime() + parseInt(m[1]) * (m[2].startsWith("h") ? 3600_000 : 60_000)).toISOString();
    return new Date(from.getTime() + 24 * 3600_000).toISOString();
  }
  return null;
}

export async function seedDefaults(db: DB, userId: string) {
  const { count } = await db.from("saved_searches").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (!count) {
    await db.from("saved_searches").insert(
      DEFAULT_PRESETS.map((p, i) => ({
        user_id: userId,
        name: p.name,
        query: p.query,
        filters: p.filters,
        sources: [],
        schedule: i === 0 ? "12h" : "manual",
        enabled: true,
        is_preset: true,
        next_run_at: i === 0 ? new Date().toISOString() : null,
      })),
    );
  }
  const { DEFAULT_ANSWER_LIBRARY } = await import("../defaults");
  await db.from("answer_library").upsert(
    DEFAULT_ANSWER_LIBRARY.map((a) => ({ user_id: userId, key: a.key, question: a.question, answer: "", category: a.category, verified: false })),
    { onConflict: "user_id,key", ignoreDuplicates: true },
  );
  await db.from("agent_state").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
}
