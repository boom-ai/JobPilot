// Run a search across sources in parallel. A failing source never fails the whole search.
import type { AppSettings, NormalizedJob } from "../types";
import { automatedSources, sourceById } from "./adapters";
import type { SearchQuery } from "./types";

export interface SourceRunResult {
  source: string;
  ok: boolean;
  count: number;
  ms: number;
  error?: string;
  logs: string[];
  skipped?: string;
}

const lastCall = new Map<string, number>();

export async function runSources(
  q: SearchQuery,
  settings: AppSettings,
  opts: { sources?: string[]; fetchImpl?: typeof fetch; respectRateLimit?: boolean } = {},
): Promise<{ jobs: NormalizedJob[]; results: SourceRunResult[] }> {
  const wanted = (opts.sources?.length ? opts.sources : settings.sources.enabled)
    .map((id) => sourceById(id))
    .filter((a): a is NonNullable<typeof a> => !!a && a.kind !== "manual" && !!a.search);
  const results: SourceRunResult[] = [];
  const jobs: NormalizedJob[] = [];
  await Promise.all(
    wanted.map(async (adapter) => {
      const st = adapter.status(settings);
      const logs: string[] = [];
      if (st === "disabled" || st === "needs_config") {
        results.push({ source: adapter.id, ok: false, count: 0, ms: 0, logs, skipped: st === "disabled" ? "disabled" : "needs configuration" });
        return;
      }
      const since = Date.now() - (lastCall.get(adapter.id) ?? 0);
      if (opts.respectRateLimit !== false && since < adapter.minIntervalMs) {
        results.push({ source: adapter.id, ok: false, count: 0, ms: 0, logs, skipped: `rate limit (wait ${Math.ceil((adapter.minIntervalMs - since) / 1000)}s)` });
        return;
      }
      lastCall.set(adapter.id, Date.now());
      const t0 = Date.now();
      try {
        const found = await adapter.search!(q, { settings, fetch: opts.fetchImpl ?? fetch, log: (m) => logs.push(m) });
        const capped = found.slice(0, q.limit ?? 150);
        jobs.push(...capped);
        results.push({ source: adapter.id, ok: true, count: capped.length, ms: Date.now() - t0, logs });
      } catch (e) {
        results.push({ source: adapter.id, ok: false, count: 0, ms: Date.now() - t0, error: (e as Error).message, logs });
      }
    }),
  );
  results.sort((a, b) => a.source.localeCompare(b.source));
  return { jobs, results };
}

export { automatedSources };
