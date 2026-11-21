// Shared domain types for Job Pilot AI.

export interface ExperienceItem {
  id: string;
  title: string;
  company: string;
  location?: string;
  start?: string; // "Dec 2025" / "2025-12"
  end?: string; // "Jul 2026" | "Present"
  current?: boolean;
  employment_type?: string; // full-time | internship | contract ...
  bullets: Bullet[];
}

export interface Bullet {
  id: string;
  text: string;
}

export interface ProjectItem {
  id: string;
  name: string;
  description?: string;
  technologies?: string[];
  bullets: Bullet[];
  url?: string;
}

export interface EducationItem {
  id: string;
  degree: string;
  field?: string;
  institution: string;
  start?: string;
  end?: string;
  grade?: string;
}

export interface CareerProfile {
  name: string;
  email: string;
  phone: string;
  location: string;
  links: { label: string; url: string }[];
  summary: string;
  experience: ExperienceItem[];
  projects: ProjectItem[];
  education: EducationItem[];
  skills: { category: string; items: string[] }[];
  certifications: { id: string; name: string; issuer?: string; date?: string }[];
  achievements: Bullet[];
  languages: { name: string; proficiency?: string }[];
  /** Fields the parser could not determine — shown to the user, never guessed. */
  unknown_fields?: string[];
}

export type RemoteType = "remote" | "hybrid" | "onsite" | "unknown";
export type JobType = "full-time" | "part-time" | "contract" | "freelance" | "internship" | "temporary";

export interface JobPreferences {
  roles: string[];
  keywords: string[];
  exclude_keywords: string[];
  exclude_companies: string[];
  locations: string[];
  remote_types: RemoteType[];
  job_types: JobType[];
  min_salary_inr_lpa?: number | null;
  min_salary_usd_annual?: number | null;
  experience_years?: number | null; // override; otherwise computed from profile
  open_to_international_remote: boolean;
  notice_period?: string;
  expected_salary?: string;
  work_authorization?: string;
}

export interface NormalizedJob {
  title: string;
  company: string;
  company_logo?: string | null;
  location?: string | null;
  countries?: string[];
  description?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  currency?: string | null;
  salary_period?: "year" | "month" | "hour" | null;
  salary_text?: string | null;
  job_type?: JobType | null;
  remote_type?: RemoteType;
  experience_min?: number | null;
  experience_max?: number | null;
  source: string;
  source_url?: string | null;
  apply_url?: string | null;
  external_job_id?: string | null;
  skills?: string[];
  tags?: string[];
  easy_apply?: boolean | null;
  visa_sponsorship?: boolean | null;
  degree_required?: string | null;
  company_size?: string | null;
  industry?: string | null;
  deadline?: string | null;
  posted_at?: string | null;
}

export interface JobRow extends NormalizedJob {
  id: string;
  user_id: string;
  match_score: number | null;
  match_analysis: MatchAnalysis | null;
  ai_analysis: Record<string, unknown> | null;
  fingerprint: string | null;
  duplicate_of: string | null;
  hidden: boolean;
  discovered_at: string;
  analyzed_at: string | null;
  saved_search_id?: string | null;
  application?: { id: string; application_status: ApplicationStatus } | null;
  sources?: { source_name: string; source_url: string | null }[];
}

export interface ScoringWeights {
  skills: number;
  experience: number;
  title: number;
  industry: number;
  education: number;
  keywords: number;
  location: number;
  remote: number;
  employment_type: number;
  salary: number;
}

export interface MatchThresholds {
  excellent: number;
  strong: number;
  moderate: number;
}

export type Recommendation = "Excellent" | "Strong" | "Moderate" | "Low";

export interface MatchAnalysis {
  overall: number;
  breakdown: {
    skills: number;
    experience: number;
    title: number;
    industry: number;
    education: number;
    keywords: number;
    location: number;
    remote: number;
    employment_type: number;
    salary: number;
  };
  display: {
    skills: number;
    experience: number;
    education: number;
    location: number;
    salary: number;
    preference: number;
  };
  matched_skills: string[];
  missing_skills: string[];
  required_years: number | null;
  candidate_years: number;
  why_match: string[];
  strengths: string[];
  missing_qualifications: string[];
  risks: string[];
  recommendation: Recommendation;
  version: number;
}

export const APPLICATION_STATUSES = [
  "discovered",
  "saved",
  "shortlisted",
  "resume_generated",
  "ready_to_apply",
  "awaiting_approval",
  "applied",
  "application_confirmed",
  "recruiter_contacted",
  "interview",
  "assessment",
  "offer",
  "rejected",
  "withdrawn",
  "expired",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  discovered: "Discovered",
  saved: "Saved",
  shortlisted: "Shortlisted",
  resume_generated: "Resume Generated",
  ready_to_apply: "Ready to Apply",
  awaiting_approval: "Awaiting Approval",
  applied: "Applied",
  application_confirmed: "Application Confirmed",
  recruiter_contacted: "Recruiter Contacted",
  interview: "Interview",
  assessment: "Assessment",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

export interface JobFilters {
  q?: string;
  remote_types?: RemoteType[];
  locations?: string[];
  countries?: string[];
  international_remote?: boolean;
  job_types?: JobType[];
  salary_min_lpa?: number | null;
  salary_max_lpa?: number | null;
  salary_min_usd?: number | null;
  include_undisclosed_salary?: boolean;
  experience?: { min?: number | null; max?: number | null } | null;
  fresher_ok?: boolean;
  roles?: string[];
  skills?: string[];
  industries?: string[];
  company_sizes?: string[];
  degree_not_required?: boolean;
  visa_sponsorship?: boolean;
  easy_apply?: boolean;
  ai_related?: boolean;
  non_technical?: boolean;
  non_coding?: boolean;
  posted_within_days?: number | null;
  min_score?: number | null;
  exclude_companies?: string[];
  exclude_keywords?: string[];
  hide_applied?: boolean;
  hide_rejected?: boolean;
  hide_duplicates?: boolean;
  deadline_after?: string | null;
  sources?: string[];
  /** internal: include hidden jobs (Hidden view) */
  include_hidden?: boolean;
}

export interface AppSettings {
  ai: {
    provider: "gemini" | "openai" | "none";
    model: string;
    tailoring_tone: "concise" | "balanced" | "detailed";
    use_ai_for_scoring_narrative: boolean;
    grounded_company_research: boolean;
  };
  scoring: { weights: ScoringWeights; thresholds: MatchThresholds };
  automation: {
    mode: "manual" | "assisted" | "auto";
    auto_search: boolean;
    auto_tailor_min_score: number; // generate tailored resume for jobs >= this
    auto_apply_min_score: number; // 90
    approval_min_score: number; // 80
    daily_limit: number;
    weekly_limit: number;
    per_company_limit: number;
    per_source_daily_limit: number;
    allowed_auto_sources: string[]; // greenhouse | lever | ashby
    approve_declarations: boolean;
    captcha_wait_minutes: number;
  };
  notifications: {
    in_app: Record<string, boolean>;
    telegram_chat_id?: string;
    discord_webhook_url?: string;
    high_match_threshold: number;
  };
  sources: {
    enabled: string[];
    greenhouse_boards: string[];
    lever_companies: string[];
    ashby_boards: string[];
    workday_sites: string[]; // "https://tenant.wd5.myworkdayjobs.com/en-US/Site"
    exchange_rate_usd_inr?: number | null;
  };
  app_name: string;
}
