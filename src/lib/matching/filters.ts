// Apply JobFilters to jobs. Used by Discover, saved searches and the scheduled pipeline,
// so filters behave identically everywhere.
import type { ApplicationStatus, JobFilters, NormalizedJob } from "../types";
import { extractSkills } from "../skills";
import {
  containsTerm,
  detectCountries,
  detectDegree,
  detectExperience,
  detectRemoteType,
  isAIRelated,
  isCodingRole,
  isTechnicalRole,
  normalize,
  normalizeCompany,
  toAnnualINR,
  toAnnualUSD,
} from "../text";

export interface FilterableJob extends NormalizedJob {
  id?: string;
  match_score?: number | null;
  duplicate_of?: string | null;
  hidden?: boolean;
  discovered_at?: string;
  application?: { application_status: ApplicationStatus } | null;
}

export interface FilterResult<T> {
  kept: T[];
  excluded: { job: T; reason: string }[];
}

const APPLIED: ApplicationStatus[] = ["applied", "application_confirmed", "recruiter_contacted", "interview", "assessment", "offer"];

export function jobRemote(j: NormalizedJob): string {
  return j.remote_type && j.remote_type !== "unknown" ? j.remote_type : detectRemoteType(j.title, j.location, (j.description ?? "").slice(0, 1500));
}

export function filterJobs<T extends FilterableJob>(jobs: T[], f: JobFilters, opts: { usdInr?: number | null; now?: Date } = {}): FilterResult<T> {
  const kept: T[] = [];
  const excluded: { job: T; reason: string }[] = [];
  const now = opts.now ?? new Date();
  for (const j of jobs) {
    const reason = rejectReason(j, f, opts.usdInr ?? null, now);
    if (reason) excluded.push({ job: j, reason });
    else kept.push(j);
  }
  return { kept, excluded };
}

function rejectReason(j: FilterableJob, f: JobFilters, usdInr: number | null, now: Date): string | null {
  const text = normalize(`${j.title} ${j.company} ${j.location ?? ""} ${(j.tags ?? []).join(" ")} ${j.description ?? ""}`);
  if (f.q) {
    const terms = f.q.split(/\s+OR\s+|,/i).map((s) => s.trim()).filter(Boolean);
    const ok = terms.some((term) => normalize(term).split(" ").every((w) => text.includes(w)));
    if (!ok) return "query";
  }
  if (f.hide_duplicates !== false && j.duplicate_of) return "duplicate";
  if (j.hidden) return "hidden";
  if (f.exclude_companies?.length && f.exclude_companies.some((c) => c && normalizeCompany(c) === normalizeCompany(j.company))) return "excluded company";
  if (f.exclude_keywords?.length && f.exclude_keywords.some((k) => k && containsTerm(normalize(`${j.title} ${j.description ?? ""}`), k))) return "excluded keyword";
  const remote = jobRemote(j);
  if (f.remote_types?.length && !f.remote_types.includes(remote as never)) return "remote type";
  const countries = j.countries?.length ? j.countries : detectCountries(j.location, remote === "remote" ? (j.description ?? "").slice(0, 600) : "");
  if (f.international_remote && !(remote === "remote" && (countries.length === 0 || countries.some((c) => c === "Worldwide" || c === "India" || c === "APAC")))) return "international remote";
  if (f.countries?.length) {
    const want = f.countries.map(normalize);
    const has = countries.map(normalize);
    if (!want.some((w) => has.includes(w)) && !(remote === "remote" && has.includes("worldwide"))) return "country";
  }
  if (f.locations?.length) {
    const want = f.locations.map(normalize).filter(Boolean);
    const loc = normalize(`${j.location ?? ""} ${countries.join(" ")}`);
    const anyRemote = want.includes("remote") && remote === "remote";
    const anywhere = want.includes("anywhere");
    if (!anywhere && !anyRemote && !want.some((w) => loc.includes(w))) return "location";
  }
  if (f.job_types?.length && j.job_type && !f.job_types.includes(j.job_type)) return "employment type";
  // salary
  const hasSalary = j.salary_min != null || j.salary_max != null;
  if ((f.salary_min_lpa || f.salary_max_lpa || f.salary_min_usd) && !hasSalary && f.include_undisclosed_salary === false) return "undisclosed salary";
  if (hasSalary) {
    const top = j.salary_max ?? j.salary_min;
    const bottom = j.salary_min ?? j.salary_max;
    if (f.salary_min_lpa) {
      const inr = toAnnualINR(top, j.currency, j.salary_period, usdInr);
      if (inr != null && inr < f.salary_min_lpa * 1e5) return "salary below minimum";
    }
    if (f.salary_max_lpa) {
      const inr = toAnnualINR(bottom, j.currency, j.salary_period, usdInr);
      if (inr != null && inr > f.salary_max_lpa * 1e5) return "salary above maximum";
    }
    if (f.salary_min_usd) {
      const usd = toAnnualUSD(top, j.currency, j.salary_period, usdInr);
      if (usd != null && usd < f.salary_min_usd) return "salary below USD minimum";
    }
  }
  // experience
  if (f.experience && (f.experience.min != null || f.experience.max != null)) {
    const req = j.experience_min != null ? { min: j.experience_min, max: j.experience_max ?? null } : detectExperience(j.description ?? j.title);
    if (req.min != null) {
      if (f.experience.max != null && req.min > f.experience.max) return "experience above range";
      if (f.experience.min != null && (req.max ?? req.min) < f.experience.min) return "experience below range";
    } else if (f.fresher_ok === false) return "experience unknown";
  }
  if (f.fresher_ok && /\b(senior|sr\.?|lead|principal|staff|head|director|manager)\b/i.test(j.title)) return "senior title";
  if (f.roles?.length) {
    const t = normalize(j.title);
    const ok = f.roles.some((r) => normalize(r).split(" ").filter((w) => w.length > 2 && w !== "ai").every((w) => t.includes(w)) || t.includes(normalize(r)));
    if (!ok) return "role";
  }
  if (f.skills?.length) {
    const js = new Set(extractSkills(text));
    if (!f.skills.some((s) => js.has(s) || text.includes(normalize(s)))) return "skills";
  }
  if (f.industries?.length && !f.industries.some((i) => text.includes(normalize(i)) || normalize(j.industry) === normalize(i))) return "industry";
  if (f.company_sizes?.length && (!j.company_size || !f.company_sizes.includes(j.company_size))) return "company size";
  if (f.degree_not_required && ["bachelors", "masters", "phd"].includes(j.degree_required ?? detectDegree(j.description) ?? "")) return "degree required";
  if (f.visa_sponsorship && !(j.visa_sponsorship === true || /visa sponsorship (is )?(available|provided)|will sponsor/i.test(j.description ?? ""))) return "no visa sponsorship";
  if (f.easy_apply && !j.easy_apply) return "not easy apply";
  if (f.ai_related && !isAIRelated(j.title, j.description, (j.tags ?? []).join(" "))) return "not AI-related";
  if (f.non_technical && isTechnicalRole(j.title)) return "technical role";
  if (f.non_coding && isCodingRole(j.title, j.description)) return "coding role";
  if (f.posted_within_days) {
    const d = j.posted_at ?? j.discovered_at;
    if (d && now.getTime() - new Date(d).getTime() > f.posted_within_days * 864e5) return "too old";
  }
  if (f.min_score != null && (j.match_score ?? 0) < f.min_score) return "below match score";
  const st = j.application?.application_status;
  if (f.hide_applied && st && APPLIED.includes(st)) return "already applied";
  if (f.hide_rejected && st === "rejected") return "previously rejected";
  if (f.deadline_after && j.deadline && j.deadline < f.deadline_after) return "deadline passed";
  if (f.sources?.length && !f.sources.includes(j.source)) return "source";
  return null;
}

export type SortKey = "score" | "salary" | "posted" | "company" | "location" | "remote" | "deadline" | "discovered";

export function sortJobs<T extends FilterableJob>(jobs: T[], key: SortKey, usdInr?: number | null): T[] {
  const arr = [...jobs];
  const sal = (j: T) => toAnnualINR(j.salary_max ?? j.salary_min, j.currency, j.salary_period, usdInr ?? 85) ?? -1;
  const time = (s?: string | null) => (s ? new Date(s).getTime() : 0);
  const cmp: Record<SortKey, (a: T, b: T) => number> = {
    score: (a, b) => (b.match_score ?? -1) - (a.match_score ?? -1),
    salary: (a, b) => sal(b) - sal(a),
    posted: (a, b) => time(b.posted_at ?? b.discovered_at) - time(a.posted_at ?? a.discovered_at),
    discovered: (a, b) => time(b.discovered_at) - time(a.discovered_at),
    company: (a, b) => a.company.localeCompare(b.company),
    location: (a, b) => (a.location ?? "").localeCompare(b.location ?? ""),
    remote: (a, b) => Number(jobRemote(b) === "remote") - Number(jobRemote(a) === "remote"),
    deadline: (a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"),
  };
  return arr.sort(cmp[key]);
}
