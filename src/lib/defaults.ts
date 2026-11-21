import type { AppSettings, JobFilters, JobPreferences } from "./types";

export const DEFAULT_ROLES = [
  "AI Data Annotator",
  "LLM Evaluator",
  "AI Trainer",
  "AI Quality Analyst",
  "AI Response Evaluator",
  "Data Annotation Specialist",
  "AI Model Reviewer",
  "Prompt Evaluator",
  "AI Operations Associate",
  "Model Quality Analyst",
  "Search Quality Rater",
  "Content Quality Analyst",
  "AI Annotation Specialist",
  "AI Training Specialist",
  "Generative AI Evaluator",
  "AI Content Evaluator",
  "AI Model Evaluator",
];

export const DEFAULT_PREFERENCES: JobPreferences = {
  roles: DEFAULT_ROLES,
  keywords: ["LLM", "annotation", "RLHF", "evaluation", "AI trainer", "data labeling", "quality analyst"],
  exclude_keywords: ["senior staff", "principal", "director"],
  exclude_companies: [],
  locations: ["India", "Remote"],
  remote_types: ["remote", "hybrid"],
  job_types: ["full-time", "contract"],
  min_salary_inr_lpa: null,
  min_salary_usd_annual: null,
  experience_years: null,
  open_to_international_remote: true,
  notice_period: "",
  expected_salary: "",
  work_authorization: "",
};

export const DEFAULT_SETTINGS: AppSettings = {
  app_name: "Job Pilot AI",
  ai: {
    provider: "gemini",
    model: "gemini-2.5-flash",
    tailoring_tone: "balanced",
    use_ai_for_scoring_narrative: true,
    grounded_company_research: true,
  },
  scoring: {
    weights: {
      skills: 25,
      experience: 15,
      title: 20,
      industry: 5,
      education: 5,
      keywords: 10,
      location: 5,
      remote: 7,
      employment_type: 4,
      salary: 4,
    },
    thresholds: { excellent: 90, strong: 80, moderate: 65 },
  },
  automation: {
    mode: "assisted",
    auto_search: true,
    auto_tailor_min_score: 80,
    auto_apply_min_score: 90,
    approval_min_score: 80,
    daily_limit: 15,
    weekly_limit: 60,
    per_company_limit: 2,
    per_source_daily_limit: 10,
    allowed_auto_sources: ["greenhouse", "lever", "ashby"],
    approve_declarations: false,
    captcha_wait_minutes: 10,
  },
  notifications: {
    in_app: {
      high_match: true,
      saved_search: true,
      application: true,
      failure: true,
      recruiter: true,
      interview: true,
      followup: true,
      resume: true,
      agent_error: true,
    },
    high_match_threshold: 85,
  },
  sources: {
    enabled: ["remoteok", "remotive", "weworkremotely", "himalayas", "arbeitnow", "greenhouse", "lever", "ashby"],
    // Public ATS job boards to watch. Edit in Settings → Sources. Tokens are the slug in the board URL.
    greenhouse_boards: ["scaleai", "anthropic"],
    lever_companies: [],
    ashby_boards: [],
    workday_sites: [],
    exchange_rate_usd_inr: null,
  },
};

export interface PresetDef {
  name: string;
  query: { keywords: string; roles: string[]; locations: string[]; exclude: string[] };
  filters: JobFilters;
}

export const DEFAULT_PRESETS: PresetDef[] = [
  {
    name: "Remote AI Jobs",
    query: { keywords: "AI", roles: [], locations: [], exclude: [] },
    filters: { remote_types: ["remote"], ai_related: true },
  },
  {
    name: "Non-Coding AI Jobs",
    query: { keywords: "AI evaluation annotation", roles: [], locations: [], exclude: [] },
    filters: { ai_related: true, non_coding: true },
  },
  {
    name: "India 5+ LPA",
    query: { keywords: "", roles: [], locations: ["India"], exclude: [] },
    filters: { countries: ["India"], salary_min_lpa: 5, include_undisclosed_salary: false },
  },
  {
    name: "International Remote",
    query: { keywords: "", roles: [], locations: [], exclude: [] },
    filters: { remote_types: ["remote"], international_remote: true },
  },
  {
    name: "Entry-Level",
    query: { keywords: "", roles: [], locations: [], exclude: [] },
    filters: { experience: { min: 0, max: 2 }, fresher_ok: true },
  },
  {
    name: "AI Annotation",
    query: { keywords: "annotation labeling", roles: ["AI Data Annotator", "Data Annotation Specialist"], locations: [], exclude: [] },
    filters: { ai_related: true },
  },
  {
    name: "LLM Evaluator",
    query: { keywords: "LLM evaluation RLHF", roles: ["LLM Evaluator", "AI Response Evaluator", "Generative AI Evaluator"], locations: [], exclude: [] },
    filters: { ai_related: true },
  },
  {
    name: "High-Match Jobs",
    query: { keywords: "", roles: [], locations: [], exclude: [] },
    filters: { min_score: 80 },
  },
];

export const DEFAULT_ANSWER_LIBRARY: { key: string; question: string; category: string }[] = [
  { key: "notice_period", question: "What is your notice period?", category: "employment" },
  { key: "salary_expectation", question: "What are your salary expectations?", category: "salary" },
  { key: "current_ctc", question: "What is your current CTC?", category: "salary" },
  { key: "work_authorization", question: "Are you authorized to work in this country?", category: "authorization" },
  { key: "relocation", question: "Are you willing to relocate?", category: "employment" },
  { key: "introduction", question: "Tell us about yourself.", category: "introduction" },
  { key: "career_goals", question: "What are your career goals?", category: "career" },
];

export function mergeSettings(stored: Partial<AppSettings> | null | undefined): AppSettings {
  const s = stored ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    ai: { ...DEFAULT_SETTINGS.ai, ...(s.ai ?? {}) },
    scoring: {
      weights: { ...DEFAULT_SETTINGS.scoring.weights, ...(s.scoring?.weights ?? {}) },
      thresholds: { ...DEFAULT_SETTINGS.scoring.thresholds, ...(s.scoring?.thresholds ?? {}) },
    },
    automation: { ...DEFAULT_SETTINGS.automation, ...(s.automation ?? {}) },
    notifications: {
      ...DEFAULT_SETTINGS.notifications,
      ...(s.notifications ?? {}),
      in_app: { ...DEFAULT_SETTINGS.notifications.in_app, ...(s.notifications?.in_app ?? {}) },
    },
    sources: { ...DEFAULT_SETTINGS.sources, ...(s.sources ?? {}) },
  };
}

export function mergePreferences(stored: Partial<JobPreferences> | null | undefined): JobPreferences {
  return { ...DEFAULT_PREFERENCES, ...(stored ?? {}) };
}
