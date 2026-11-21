// Deterministic, explainable job ↔ profile scoring (0–100).
// Works with no AI configured; AI can later add narrative on top, never change facts.

import type { CareerProfile, JobPreferences, MatchAnalysis, MatchThresholds, NormalizedJob, Recommendation, ScoringWeights } from "../types";
import { extractSkills, profileSkillSet } from "../skills";
import { experienceYears } from "../resume/parse";
import {
  detectCountries,
  detectDegree,
  detectExperience,
  detectRemoteType,
  isAIRelated,
  isCodingRole,
  jaccard,
  normalize,
  tokenize,
  toAnnualINR,
  toAnnualUSD,
} from "../text";
import { DEFAULT_SETTINGS } from "../defaults";

export const SCORING_VERSION = 3;

// Role-family synonyms so "Data Labeler" ≈ "AI Data Annotator", "Rater" ≈ "Evaluator", etc.
const ROLE_FAMILIES: string[][] = [
  ["annotator", "annotation", "labeler", "labeller", "labeling", "labelling", "tagger", "data specialist"],
  ["evaluator", "evaluation", "rater", "reviewer", "assessor", "grader", "judge", "tester"],
  ["trainer", "training", "tutor", "ai tutor", "writer", "expert"],
  ["quality", "qa", "quality analyst", "quality assurance", "qc"],
  ["analyst", "associate", "specialist", "operations"],
  ["llm", "ai", "genai", "generative", "model", "ml", "chatbot", "prompt"],
];

function familyTokens(s: string): Set<string> {
  const n = normalize(s);
  const out = new Set(tokenize(s));
  ROLE_FAMILIES.forEach((fam, i) => {
    if (fam.some((w) => new RegExp(`\\b${w}\\b`).test(n))) out.add(`#fam${i}`);
  });
  return out;
}

export function titleSimilarity(jobTitle: string, targets: string[]): { score: number; best: string | null } {
  const jt = familyTokens(jobTitle);
  let best = 0;
  let bestT: string | null = null;
  for (const t of targets) {
    const tt = familyTokens(t);
    // weighted: overlap of family markers matters most, raw word overlap second
    const famA = new Set([...jt].filter((x) => x.startsWith("#")));
    const famB = new Set([...tt].filter((x) => x.startsWith("#")));
    const wordsA = new Set([...jt].filter((x) => !x.startsWith("#")));
    const wordsB = new Set([...tt].filter((x) => !x.startsWith("#")));
    const famOverlap = famB.size ? [...famB].filter((x) => famA.has(x)).length / famB.size : 0;
    const s = 0.65 * famOverlap + 0.35 * jaccard(wordsA, wordsB) * 1.6;
    if (s > best) {
      best = s;
      bestT = t;
    }
  }
  return { score: Math.min(100, Math.round(best * 100)), best: bestT };
}

export interface ScoreContext {
  profile: CareerProfile;
  preferences: JobPreferences;
  weights?: ScoringWeights;
  thresholds?: MatchThresholds;
  usdInr?: number | null;
  now?: Date;
}

export function recommendationFor(score: number, th: MatchThresholds = DEFAULT_SETTINGS.scoring.thresholds): Recommendation {
  if (score >= th.excellent) return "Excellent";
  if (score >= th.strong) return "Strong";
  if (score >= th.moderate) return "Moderate";
  return "Low";
}

export function scoreJob(job: NormalizedJob, ctx: ScoreContext): MatchAnalysis {
  const weights = ctx.weights ?? DEFAULT_SETTINGS.scoring.weights;
  const { profile, preferences } = ctx;
  const desc = job.description ?? "";
  const fullText = `${job.title}\n${desc}\n${(job.tags ?? []).join(" ")}`;
  const risks: string[] = [];
  const why: string[] = [];
  const strengths: string[] = [];
  const missingQ: string[] = [];

  // ---- skills ---------------------------------------------------------------
  const jobSkills = new Set([...(job.skills ?? []).flatMap((s) => extractSkills(s).concat()), ...extractSkills(fullText)]);
  const { explicit, evidenced } = profileSkillSet(profile);
  const have = new Set([...explicit, ...evidenced]);
  const matched = [...jobSkills].filter((s) => have.has(s));
  const missing = [...jobSkills].filter((s) => !have.has(s));
  // Language/soft skills count, but generic ones shouldn't dominate
  const SOFT = new Set(["Attention to Detail", "Written Communication", "Critical Thinking", "Research", "English", "Hindi", "Punjabi"]);
  const hardJob = [...jobSkills].filter((s) => !SOFT.has(s));
  const hardMatched = hardJob.filter((s) => have.has(s));
  const softJob = [...jobSkills].filter((s) => SOFT.has(s));
  let skillsScore: number;
  if (!jobSkills.size) skillsScore = 55; // unknown requirements
  else if (!hardJob.length) skillsScore = 70;
  else skillsScore = Math.round(100 * (0.85 * (hardMatched.length / hardJob.length) + 0.15 * (softJob.length ? 1 : 0.5)));
  skillsScore = Math.min(100, skillsScore);
  if (hardMatched.length) why.push(`You have ${hardMatched.length} of ${hardJob.length} key skills: ${hardMatched.slice(0, 6).join(", ")}.`);
  for (const m of missing.filter((s) => !SOFT.has(s)).slice(0, 6)) missingQ.push(`Skill not in your profile: ${m}`);

  // ---- experience -----------------------------------------------------------
  const candYears = preferences.experience_years ?? experienceYears(profile.experience, ctx.now);
  const req = job.experience_min != null ? { min: job.experience_min, max: job.experience_max ?? null } : detectExperience(desc || job.title);
  let expScore = 75;
  if (req.min != null) {
    const gap = req.min - candYears;
    if (gap <= 0.25) expScore = 100;
    else if (gap <= 1) expScore = 80;
    else if (gap <= 2) expScore = 55;
    else if (gap <= 3) expScore = 35;
    else expScore = 15;
    if (gap > 0.25) risks.push(`Experience mismatch: asks for ${req.min}+ years, profile shows ~${candYears}.`);
    else why.push(`Experience requirement (${req.min}${req.max ? `–${req.max}` : "+"} yrs) fits your ~${candYears} yrs.`);
    if (req.max != null && candYears > req.max + 3) {
      expScore = Math.min(expScore, 70);
      risks.push("You may be overqualified for this level.");
    }
  }
  if (/\b(senior|sr\.?|lead|principal|staff|head|manager|director)\b/i.test(job.title) && candYears < 3) {
    expScore = Math.min(expScore, 35);
    risks.push("Title indicates a senior level.");
  }

  // ---- title ----------------------------------------------------------------
  const targets = [...preferences.roles, ...profile.experience.map((e) => e.title)];
  const ts = titleSimilarity(job.title, targets);
  const titleScore = ts.score;
  if (titleScore >= 60 && ts.best) why.push(`Title closely matches your target “${ts.best}”.`);

  // ---- industry -------------------------------------------------------------
  const aiJob = isAIRelated(job.title, desc, (job.tags ?? []).join(" "));
  const profileAI = isAIRelated(profile.summary, profile.experience.map((e) => e.title + " " + e.bullets.map((b) => b.text).join(" ")).join(" "));
  const industryScore = aiJob && profileAI ? 100 : aiJob || !profileAI ? 60 : 40;
  if (aiJob && profileAI) strengths.push("You have direct AI/LLM industry experience.");

  // ---- education ------------------------------------------------------------
  const degreeReq = job.degree_required ?? detectDegree(desc);
  const hasBachelors = profile.education.some((e) => /bachelor|b\.?\s?tech|b\.?e\b|b\.?sc|bca|degree/i.test(e.degree));
  const hasMasters = profile.education.some((e) => /master|m\.?\s?tech|m\.?sc|mba|mca/i.test(e.degree));
  let eduScore = 85;
  if (degreeReq === "phd") {
    eduScore = 20;
    missingQ.push("PhD required");
  } else if (degreeReq === "masters") {
    eduScore = hasMasters ? 100 : 40;
    if (!hasMasters) missingQ.push("Master's degree preferred/required");
  } else if (degreeReq === "bachelors") {
    eduScore = hasBachelors ? 100 : 45;
    if (!hasBachelors) missingQ.push("Bachelor's degree required");
  } else if (hasBachelors) eduScore = 95;

  // ---- keywords ------------------------------------------------------------
  const prefKeywords = [...preferences.keywords];
  const jobNorm = normalize(fullText);
  const kwHits = prefKeywords.filter((k) => jobNorm.includes(normalize(k)));
  const profileTokens = new Set(tokenize([profile.summary, ...profile.experience.flatMap((e) => e.bullets.map((b) => b.text))].join(" ")));
  const jobTokens = new Set(tokenize(fullText));
  const overlap = jaccard(profileTokens, jobTokens);
  const kwScore = Math.min(100, Math.round((prefKeywords.length ? (kwHits.length / Math.min(prefKeywords.length, 4)) * 60 : 30) + overlap * 250));
  if (kwHits.length) why.push(`Mentions your keywords: ${kwHits.slice(0, 5).join(", ")}.`);

  // ---- location & remote ----------------------------------------------------
  const remote = job.remote_type && job.remote_type !== "unknown" ? job.remote_type : detectRemoteType(job.title, job.location, desc.slice(0, 1500));
  const countries = job.countries?.length ? job.countries : detectCountries(job.location);
  const prefLocs = preferences.locations.map((l) => normalize(l));
  const locNorm = normalize(job.location);
  let locScore = 60;
  if (remote === "remote") {
    const restricted = countries.filter((c) => c !== "Worldwide" && c !== "India" && c !== "APAC");
    if (restricted.length && !countries.includes("India") && !countries.includes("Worldwide")) {
      locScore = 30;
      risks.push(`Remote but restricted to: ${restricted.join(", ")}.`);
    } else locScore = 100;
  } else if (prefLocs.some((l) => l && l !== "remote" && (locNorm.includes(l) || countries.map(normalize).includes(l)))) locScore = 90;
  else if (countries.length && !countries.includes("India")) {
    locScore = 20;
    risks.push(`On-site/hybrid outside India: ${job.location ?? countries.join(", ")}.`);
  }
  const remoteScore = preferences.remote_types.includes(remote as never) ? 100 : remote === "unknown" ? 60 : 25;
  if (remote === "remote" && preferences.remote_types.includes("remote")) strengths.push("Remote role matches your preference.");

  // ---- employment type ------------------------------------------------------
  const jt = job.job_type;
  const typeScore = !jt ? 70 : preferences.job_types.includes(jt) ? 100 : 40;

  // ---- salary ---------------------------------------------------------------
  let salaryScore = 70; // undisclosed: neutral
  const minINR = preferences.min_salary_inr_lpa ? preferences.min_salary_inr_lpa * 100000 : null;
  const jobMaxINR = toAnnualINR(job.salary_max ?? job.salary_min, job.currency, job.salary_period, ctx.usdInr);
  const jobMaxUSD = toAnnualUSD(job.salary_max ?? job.salary_min, job.currency, job.salary_period, ctx.usdInr);
  if (minINR && jobMaxINR != null) {
    salaryScore = jobMaxINR >= minINR ? 100 : Math.max(10, Math.round((jobMaxINR / minINR) * 100) - 20);
    if (jobMaxINR < minINR) risks.push(`Salary mismatch: up to ₹${(jobMaxINR / 1e5).toFixed(1)} LPA vs your minimum ₹${preferences.min_salary_inr_lpa} LPA.`);
  } else if (preferences.min_salary_usd_annual && jobMaxUSD != null) {
    salaryScore = jobMaxUSD >= preferences.min_salary_usd_annual ? 100 : 35;
    if (jobMaxUSD < preferences.min_salary_usd_annual) risks.push("Salary below your USD minimum.");
  } else if (job.salary_min != null) salaryScore = 80;

  // ---- coding requirement vs preference -------------------------------------
  if (isCodingRole(job.title, desc)) {
    risks.push("Role appears to require hands-on software engineering.");
  }
  const reqCert = /\b(certification|certified)\b[^.]{0,60}\b(required|must)\b/i.exec(desc);
  if (reqCert) risks.push("Mentions a required certification — check the listing.");

  // ---- combine --------------------------------------------------------------
  const breakdown = {
    skills: skillsScore,
    experience: expScore,
    title: titleScore,
    industry: industryScore,
    education: eduScore,
    keywords: kwScore,
    location: locScore,
    remote: remoteScore,
    employment_type: typeScore,
    salary: salaryScore,
  };
  const totalW = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  let overall = 0;
  for (const k of Object.keys(breakdown) as (keyof typeof breakdown)[]) overall += breakdown[k] * (weights[k] ?? 0);
  overall = overall / totalW;
  // hard penalties: excluded keywords/companies, location impossibility
  const exclK = preferences.exclude_keywords.filter((k) => k && normalize(job.title).includes(normalize(k)));
  if (exclK.length) {
    overall *= 0.5;
    risks.push(`Title contains excluded keyword: ${exclK.join(", ")}.`);
  }
  if (locScore <= 30) overall = Math.min(overall, 60);
  if (titleScore < 25 && !aiJob) overall = Math.min(overall, 55);
  const score = Math.max(0, Math.min(100, Math.round(overall)));

  if (hardMatched.length >= 3) strengths.push(`Strong skill overlap: ${hardMatched.slice(0, 4).join(", ")}.`);
  if (expScore === 100) strengths.push("Meets the stated experience requirement.");
  if (hasBachelors && degreeReq === "bachelors") strengths.push("Meets the degree requirement.");

  return {
    overall: score,
    breakdown,
    display: {
      skills: skillsScore,
      experience: expScore,
      education: eduScore,
      location: Math.round((locScore + remoteScore) / 2),
      salary: salaryScore,
      preference: Math.round((titleScore + typeScore + remoteScore) / 3),
    },
    matched_skills: matched,
    missing_skills: missing,
    required_years: req.min,
    candidate_years: candYears,
    why_match: why,
    strengths: [...new Set(strengths)],
    missing_qualifications: missingQ,
    risks: [...new Set(risks)],
    recommendation: recommendationFor(score, ctx.thresholds),
    version: SCORING_VERSION,
  };
}
