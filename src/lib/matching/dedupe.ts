// Duplicate detection across sources.
import type { NormalizedJob } from "../types";
import { jaccard, normalize, normalizeCompany, shingles } from "../text";

const TITLE_NOISE = /\b(remote|hybrid|onsite|on site|full time|part time|contract|india|us|usa|uk|emea|apac|worldwide|\d+)\b/g;

export function normalizeTitle(t: string): string {
  return normalize(t)
    .replace(/\(.*?\)/g, " ")
    .replace(TITLE_NOISE, " ")
    .replace(/\b(sr|snr)\b/g, "senior")
    .replace(/\b(jr)\b/g, "junior")
    .replace(/\s+/g, " ")
    .trim();
}

function locationBucket(loc: string | null | undefined, remote?: string): string {
  if (remote === "remote") return "remote";
  const n = normalize(loc);
  return n.split(" ").slice(0, 2).join(" ") || "any";
}

/** Coarse key: same company + same normalized title + same location bucket. */
export function fingerprint(job: Pick<NormalizedJob, "company" | "title" | "location" | "remote_type">): string {
  return [normalizeCompany(job.company), normalizeTitle(job.title), locationBucket(job.location, job.remote_type)].join("|");
}

export function canonicalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const drop = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "refId", "trackingId", "gh_src", "source", "lever-source"];
    for (const k of drop) u.searchParams.delete(k);
    u.hash = "";
    return (u.host.replace(/^www\./, "") + u.pathname.replace(/\/$/, "") + (u.search ? u.search : "")).toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export interface ExistingJobRef {
  id: string;
  company: string;
  title: string;
  location?: string | null;
  remote_type?: string | null;
  source: string;
  source_url?: string | null;
  external_job_id?: string | null;
  fingerprint?: string | null;
  description?: string | null;
}

export type DuplicateReason = "url" | "external_id" | "fingerprint" | "description";

/** Find an existing job that is the same posting. Returns null when the job is new. */
export function findDuplicate(job: NormalizedJob, existing: ExistingJobRef[]): { id: string; reason: DuplicateReason } | null {
  const url = canonicalUrl(job.source_url);
  const fp = fingerprint(job);
  const comp = normalizeCompany(job.company);
  let descSh: Set<string> | null = null;
  for (const e of existing) {
    if (job.external_job_id && e.external_job_id === job.external_job_id && e.source === job.source) return { id: e.id, reason: "external_id" };
    if (url && canonicalUrl(e.source_url) === url) return { id: e.id, reason: "url" };
    const efp = e.fingerprint ?? fingerprint({ company: e.company, title: e.title, location: e.location, remote_type: e.remote_type as never });
    if (efp === fp) return { id: e.id, reason: "fingerprint" };
    // Same company, similar title, near-identical description → duplicate repost / cross-post
    if (job.description && e.description && normalizeCompany(e.company) === comp) {
      const tSim = jaccard(new Set(normalizeTitle(job.title).split(" ")), new Set(normalizeTitle(e.title).split(" ")));
      if (tSim >= 0.5) {
        descSh ??= shingles(job.description);
        if (jaccard(descSh, shingles(e.description)) >= 0.8) return { id: e.id, reason: "description" };
      }
    }
  }
  return null;
}

/** Dedupe a freshly fetched batch against itself; returns unique jobs plus duplicates mapped to their first index. */
export function dedupeBatch(jobs: NormalizedJob[]): { unique: NormalizedJob[]; duplicates: { job: NormalizedJob; of: number }[] } {
  const unique: NormalizedJob[] = [];
  const refs: ExistingJobRef[] = [];
  const duplicates: { job: NormalizedJob; of: number }[] = [];
  jobs.forEach((j) => {
    const d = findDuplicate(j, refs);
    if (d) duplicates.push({ job: j, of: parseInt(d.id) });
    else {
      refs.push({ id: String(unique.length), ...j, fingerprint: fingerprint(j) });
      unique.push(j);
    }
  });
  return { unique, duplicates };
}
