// Server-side job listing used by Discover / Matches / Shortlist / dashboard drill-downs.
import type { DB } from "./supabase/clients";
import type { ApplicationStatus, JobFilters, JobRow } from "./types";
import { filterJobs, sortJobs, type SortKey } from "./matching/filters";

export const JOB_LIST_COLUMNS =
  "id, title, company, company_logo, location, countries, description, salary_min, salary_max, currency, salary_period, salary_text, job_type, remote_type, experience_min, experience_max, source, source_url, apply_url, external_job_id, skills, tags, easy_apply, visa_sponsorship, degree_required, company_size, industry, deadline, match_score, match_analysis, ai_analysis, fingerprint, duplicate_of, hidden, posted_at, discovered_at, analyzed_at, saved_search_id, applications(id, application_status), job_sources(source_name, source_url)";

type RawJob = Omit<JobRow, "application" | "sources"> & {
  applications?: { id: string; application_status: ApplicationStatus }[] | { id: string; application_status: ApplicationStatus } | null;
  job_sources?: { source_name: string; source_url: string | null }[];
};

export function shapeJob(r: RawJob): JobRow {
  const apps = Array.isArray(r.applications) ? r.applications : r.applications ? [r.applications] : [];
  const { applications: _a, job_sources, ...rest } = r;
  void _a;
  return { ...(rest as JobRow), application: apps[0] ?? null, sources: job_sources ?? [] };
}

export interface ListParams {
  view?: "all" | "discover" | "matches" | "shortlist" | "hidden" | "duplicates" | "stage";
  stage?: string;
  filters?: JobFilters;
  sort?: SortKey;
  limit?: number;
  offset?: number;
  usdInr?: number | null;
  minMatch?: number;
}

const STAGE_STATUSES: Record<string, ApplicationStatus[] | "none" | "matched"> = {
  discovered: "none",
  matched: "matched",
  shortlisted: ["shortlisted", "saved"],
  resume_ready: ["resume_generated", "ready_to_apply"],
  awaiting_approval: ["awaiting_approval"],
  applied: ["applied", "application_confirmed", "recruiter_contacted"],
  interview: ["interview", "assessment"],
  offer: ["offer"],
};

export async function listJobs(db: DB, userId: string, p: ListParams) {
  let q = db.from("jobs").select(JOB_LIST_COLUMNS).eq("user_id", userId).order("discovered_at", { ascending: false }).limit(3000);
  if (p.view === "hidden") q = q.eq("hidden", true);
  else if (p.view !== "duplicates") q = q.eq("hidden", false);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  let jobs = ((data ?? []) as unknown as RawJob[]).map(shapeJob);

  if (p.view === "duplicates") jobs = jobs.filter((j) => j.duplicate_of);
  if (p.view === "matches") jobs = jobs.filter((j) => j.match_score != null && j.match_score >= (p.minMatch ?? 65));
  if (p.view === "shortlist") jobs = jobs.filter((j) => j.application && ["shortlisted", "saved", "resume_generated", "ready_to_apply", "awaiting_approval"].includes(j.application.application_status));
  if (p.view === "stage" && p.stage) {
    const s = STAGE_STATUSES[p.stage];
    if (s === "none") jobs = jobs.filter((j) => !j.duplicate_of);
    else if (s === "matched") jobs = jobs.filter((j) => (j.match_score ?? 0) >= (p.minMatch ?? 65));
    else if (s) jobs = jobs.filter((j) => j.application && s.includes(j.application.application_status));
  }
  const filters: JobFilters = { hide_duplicates: p.view !== "duplicates", ...(p.filters ?? {}) };
  const { kept, excluded } = filterJobs(jobs, filters, { usdInr: p.usdInr });
  const sorted = sortJobs(kept, p.sort ?? (p.view === "matches" ? "score" : "discovered"), p.usdInr);
  const offset = p.offset ?? 0;
  const limit = p.limit ?? 50;
  return { total: sorted.length, excluded: excluded.length, jobs: sorted.slice(offset, offset + limit) };
}
