import { body, check, HttpError, route } from "@/lib/api";
import { listJobs } from "@/lib/jobs-query";
import { ingestJobs } from "@/lib/agent/pipeline";
import { enrich } from "@/lib/sources/adapters";
import { htmlToText } from "@/lib/text";
import type { JobFilters, NormalizedJob } from "@/lib/types";
import type { SortKey } from "@/lib/matching/filters";

export const GET = route(async (c, req) => {
  const u = new URL(req.url);
  const ctx = await c.context();
  let filters: JobFilters = {};
  try {
    filters = JSON.parse(u.searchParams.get("filters") ?? "{}");
  } catch {
    throw new HttpError(400, "filters must be JSON");
  }
  const q = u.searchParams.get("q");
  if (q) filters.q = q;
  return listJobs(c.db, c.userId, {
    view: (u.searchParams.get("view") as never) ?? "discover",
    stage: u.searchParams.get("stage") ?? undefined,
    filters,
    sort: (u.searchParams.get("sort") as SortKey) ?? undefined,
    limit: Math.min(200, parseInt(u.searchParams.get("limit") ?? "50")),
    offset: parseInt(u.searchParams.get("offset") ?? "0"),
    usdInr: ctx.settings.sources.exchange_rate_usd_inr,
    minMatch: ctx.settings.scoring.thresholds.moderate,
  });
});

/** Manually add a job (pasted description or captured page). Goes through the same dedupe/score pipeline. */
export const POST = route(async (c, req) => {
  const b = await body<Partial<NormalizedJob> & { html?: string }>(req);
  if (!b.title || !b.company) throw new HttpError(400, "title and company are required");
  const ctx = await c.context();
  const job = enrich({
    title: b.title,
    company: b.company,
    location: b.location ?? null,
    description: b.description ?? htmlToText(b.html ?? ""),
    source: b.source ?? "manual",
    source_url: b.source_url ?? null,
    apply_url: b.apply_url ?? b.source_url ?? null,
    external_job_id: b.external_job_id ?? null,
    salary_text: b.salary_text ?? null,
    remote_type: b.remote_type,
    job_type: b.job_type ?? null,
    posted_at: b.posted_at ?? null,
    company_logo: b.company_logo ?? null,
  });
  const r = await ingestJobs(c.db, ctx, [job], { applyPreferenceExclusions: false });
  if (r.inserted.length) return { created: true, id: r.inserted[0].id, score: r.inserted[0].score };
  if (r.mergedInto.length) return { created: false, duplicate_of: r.mergedInto[0] };
  const { data } = await c.db.from("jobs").select("id").eq("user_id", c.userId).eq("source_url", job.source_url ?? "__none__").maybeSingle();
  if (data) return { created: false, duplicate_of: data.id };
  check({ data: null, error: null });
  return { created: false, excluded: r.excluded[0]?.reason ?? "unknown" };
});
