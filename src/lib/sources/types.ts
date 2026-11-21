import type { AppSettings, NormalizedJob } from "../types";

export type SourceStatus = "available" | "connected" | "requires_login" | "api_unavailable" | "manual" | "disabled" | "needs_config";

export interface SearchQuery {
  keywords: string; // free text
  roles: string[];
  locations: string[];
  exclude: string[];
  limit?: number;
}

export interface AdapterContext {
  settings: AppSettings;
  fetch: typeof fetch;
  log: (msg: string) => void;
}

export interface SourceAdapter {
  id: string;
  name: string;
  kind: "api" | "rss" | "ats" | "manual";
  homepage: string;
  /** Minimum ms between requests to this source. */
  minIntervalMs: number;
  /** Notes shown in Settings → Sources. */
  notes: string;
  status(settings: AppSettings): SourceStatus;
  search?(q: SearchQuery, ctx: AdapterContext): Promise<NormalizedJob[]>;
  /** Build a search URL for manual/browser-assisted sources. */
  searchUrl?(q: SearchQuery): string;
}

export class SourceError extends Error {
  constructor(public source: string, message: string, public status?: number) {
    super(`${source}: ${message}`);
  }
}
