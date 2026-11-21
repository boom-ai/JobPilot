import { body, route } from "@/lib/api";
import { runSearchPipeline, type SavedSearchRow } from "@/lib/agent/pipeline";
import { logEvent } from "@/lib/agent/events";
import type { JobFilters } from "@/lib/types";

/** Ad-hoc search from Discover: runs the full pipeline immediately with the given query/filters/sources. */
export const POST = route(async (c, req) => {
  const b = await body<{ keywords?: string; roles?: string[]; locations?: string[]; exclude?: string[]; filters?: JobFilters; sources?: string[] }>(req);
  const ctx = await c.context();
  const logs: string[] = [];
  const search: SavedSearchRow = {
    id: "",
    user_id: c.userId,
    name: b.keywords ? `“${b.keywords}”` : "Ad-hoc search",
    query: { keywords: b.keywords ?? "", roles: b.roles ?? [], locations: b.locations ?? [], exclude: b.exclude ?? [] },
    filters: b.filters ?? {},
    sources: b.sources ?? [],
    schedule: "manual",
    enabled: true,
  };
  const r = await runSearchPipeline(c.db, ctx, { ...search, id: null as unknown as string }, (m) => {
    logs.push(m);
  });
  await logEvent(c.db, c.userId, "search_completed", `Ad-hoc search finished: ${r.ingest.inserted.length} new jobs`, {});
  return { inserted: r.ingest.inserted, duplicates: r.ingest.duplicates, excluded: r.ingest.excluded.length, sources: r.sources, logs };
});
