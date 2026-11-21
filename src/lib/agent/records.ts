// Shared DB operations for jobs and applications.
import type { DB } from "../supabase/clients";
import type { ApplicationStatus, MatchAnalysis, NormalizedJob } from "../types";
import { fingerprint, canonicalUrl } from "../matching/dedupe";
import { normalizeCompany } from "../text";

export const STATUS_TIMESTAMP: Partial<Record<ApplicationStatus, string>> = {
  shortlisted: "shortlisted_at",
  applied: "applied_at",
  application_confirmed: "confirmed_at",
  rejected: "rejected_at",
  assessment: "assessment_at",
};

/** Ordered pipeline used to avoid accidentally moving an application backwards automatically. */
const ORDER: ApplicationStatus[] = ["discovered", "saved", "shortlisted", "resume_generated", "ready_to_apply", "awaiting_approval", "applied", "application_confirmed", "recruiter_contacted", "assessment", "interview", "offer"];

export async function setApplicationStatus(
  db: DB,
  userId: string,
  jobId: string,
  status: ApplicationStatus,
  opts: { note?: string; by?: "user" | "agent"; onlyForward?: boolean; extra?: Record<string, unknown> } = {},
): Promise<{ id: string; status: ApplicationStatus; changed: boolean }> {
  const { data: existing } = await db.from("applications").select("id, application_status, status_history").eq("user_id", userId).eq("job_id", jobId).maybeSingle();
  const now = new Date().toISOString();
  if (existing) {
    const cur = existing.application_status as ApplicationStatus;
    if (cur === status && !opts.extra) return { id: existing.id, status, changed: false };
    if (opts.onlyForward && ORDER.indexOf(status) >= 0 && ORDER.indexOf(cur) > ORDER.indexOf(status)) return { id: existing.id, status: cur, changed: false };
    const history = [...((existing.status_history as unknown[]) ?? []), { from: cur, to: status, at: now, by: opts.by ?? "user", note: opts.note ?? null }];
    const patch: Record<string, unknown> = { application_status: status, status_history: history, ...(opts.extra ?? {}) };
    const ts = STATUS_TIMESTAMP[status];
    if (ts) patch[ts] = now;
    const { error } = await db.from("applications").update(patch).eq("id", existing.id);
    if (error) throw new Error(error.message);
    return { id: existing.id, status, changed: cur !== status };
  }
  const row: Record<string, unknown> = {
    user_id: userId,
    job_id: jobId,
    application_status: status,
    status_history: [{ from: null, to: status, at: now, by: opts.by ?? "user", note: opts.note ?? null }],
    ...(opts.extra ?? {}),
  };
  const ts = STATUS_TIMESTAMP[status];
  if (ts) row[ts] = now;
  const { data, error } = await db.from("applications").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  return { id: data.id, status, changed: true };
}

export async function upsertCompany(db: DB, userId: string, name: string): Promise<string | null> {
  const normalized = normalizeCompany(name) || name.toLowerCase();
  const { data } = await db.from("companies").upsert({ user_id: userId, name, normalized_name: normalized }, { onConflict: "user_id,normalized_name", ignoreDuplicates: false }).select("id").single();
  return data?.id ?? null;
}

export function jobInsertRow(userId: string, j: NormalizedJob, extra: { match?: MatchAnalysis | null; companyId?: string | null; savedSearchId?: string | null } = {}) {
  return {
    user_id: userId,
    title: j.title.slice(0, 300),
    company: j.company.slice(0, 200),
    company_id: extra.companyId ?? null,
    company_logo: j.company_logo ?? null,
    location: j.location ?? null,
    countries: j.countries ?? [],
    description: j.description ?? null,
    salary_min: j.salary_min ?? null,
    salary_max: j.salary_max ?? null,
    currency: j.currency ?? null,
    salary_period: j.salary_period ?? null,
    salary_text: j.salary_text ?? null,
    job_type: j.job_type ?? null,
    remote_type: j.remote_type ?? "unknown",
    experience_min: j.experience_min ?? null,
    experience_max: j.experience_max ?? null,
    source: j.source,
    source_url: j.source_url ?? null,
    apply_url: j.apply_url ?? j.source_url ?? null,
    external_job_id: j.external_job_id ?? null,
    skills: j.skills ?? [],
    tags: (j.tags ?? []).slice(0, 20),
    easy_apply: j.easy_apply ?? null,
    visa_sponsorship: j.visa_sponsorship ?? null,
    degree_required: j.degree_required ?? null,
    company_size: j.company_size ?? null,
    industry: j.industry ?? null,
    deadline: j.deadline ?? null,
    posted_at: j.posted_at ?? null,
    fingerprint: fingerprint(j),
    match_score: extra.match?.overall ?? null,
    match_analysis: extra.match ?? null,
    analyzed_at: extra.match ? new Date().toISOString() : null,
    saved_search_id: extra.savedSearchId ?? null,
  };
}

export { canonicalUrl };
