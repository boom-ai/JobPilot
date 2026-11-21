// AI-backed generators. Every generator:
//  - is grounded only in the candidate's master profile (+ job text / cited sources)
//  - returns `flags` for anything unknown instead of guessing
//  - has a deterministic fallback when no AI provider is configured
import { z } from "zod";
import type { CareerProfile, JobPreferences, NormalizedJob } from "../types";
import { aiAvailable, generate, generateJson, type AIConfig } from "./provider";
import { normalize, tokenize, jaccard, uid } from "../text";
import { extractSkills, profileSkillSet } from "../skills";
import { relevance, jobKeywordProfile } from "../resume/tailor";
import { emptyProfile } from "../resume/parse";

// ---------------------------------------------------------------------------
// Profile extraction
// ---------------------------------------------------------------------------
const BulletZ = z.object({ text: z.string() });
const ProfileZ = z.object({
  name: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  location: z.string().default(""),
  links: z.array(z.object({ label: z.string(), url: z.string() })).default([]),
  summary: z.string().default(""),
  experience: z.array(z.object({
    title: z.string(), company: z.string(), location: z.string().nullish(), start: z.string().nullish(), end: z.string().nullish(),
    employment_type: z.string().nullish(), bullets: z.array(BulletZ).default([]),
  })).default([]),
  projects: z.array(z.object({ name: z.string(), technologies: z.array(z.string()).nullish(), bullets: z.array(BulletZ).default([]) })).default([]),
  education: z.array(z.object({ degree: z.string(), field: z.string().nullish(), institution: z.string(), start: z.string().nullish(), end: z.string().nullish(), grade: z.string().nullish() })).default([]),
  skills: z.array(z.object({ category: z.string(), items: z.array(z.string()) })).default([]),
  certifications: z.array(z.object({ name: z.string(), issuer: z.string().nullish(), date: z.string().nullish() })).default([]),
  achievements: z.array(BulletZ).default([]),
  languages: z.array(z.object({ name: z.string(), proficiency: z.string().nullish() })).default([]),
  unknown_fields: z.array(z.string()).default([]),
});

/** Is `needle` actually present in the source text? Used to drop hallucinated entities. */
export function presentIn(source: string, needle: string | null | undefined): boolean {
  if (!needle) return true;
  const s = normalize(source);
  const n = normalize(needle);
  if (!n) return true;
  if (s.includes(n)) return true;
  const toks = n.split(" ").filter((t) => t.length > 2);
  return toks.length > 0 && toks.filter((t) => s.includes(t)).length / toks.length >= 0.8;
}

export async function extractProfileAI(ai: AIConfig, text: string, heuristic: CareerProfile): Promise<{ profile: CareerProfile; dropped: string[] }> {
  const { data } = await generateJson(
    ai,
    {
      system: "You convert resume text into structured JSON. Copy facts exactly. Never infer or invent anything not written in the text. If a field is missing, leave it empty and list it in unknown_fields.",
      prompt: `Extract this resume into JSON with keys: name, email, phone, location, links[{label,url}], summary, experience[{title,company,location,start,end,employment_type,bullets[{text}]}], projects[{name,technologies[],bullets[{text}]}], education[{degree,field,institution,start,end,grade}], skills[{category,items[]}], certifications[{name,issuer,date}], achievements[{text}], languages[{name,proficiency}], unknown_fields[].
Keep bullet wording verbatim (fix only line-wrap hyphenation). Dates as written (e.g. "Dec 2025").

RESUME TEXT:
${text.slice(0, 20000)}`,
      temperature: 0,
    },
    ProfileZ,
  );
  const dropped: string[] = [];
  const keep = <T>(arr: T[], fields: (x: T) => (string | null | undefined)[], label: (x: T) => string) =>
    arr.filter((x) => {
      const ok = fields(x).every((f) => presentIn(text, f));
      if (!ok) dropped.push(label(x));
      return ok;
    });
  const p: CareerProfile = {
    ...emptyProfile(),
    name: presentIn(text, data.name) ? data.name : heuristic.name,
    email: presentIn(text, data.email) ? data.email : heuristic.email,
    phone: data.phone && text.replace(/\D/g, "").includes(data.phone.replace(/\D/g, "").slice(-8)) ? data.phone : heuristic.phone,
    location: presentIn(text, data.location) ? data.location : heuristic.location,
    links: heuristic.links.length ? heuristic.links : data.links.filter((l) => text.includes(l.url.replace(/^https?:\/\//, "").split("/")[0])),
    summary: data.summary && jaccard(new Set(tokenize(data.summary)), new Set(tokenize(text))) > 0 ? data.summary : heuristic.summary,
    experience: keep(data.experience, (e) => [e.company, e.title, e.start ?? undefined], (e) => `experience: ${e.title} @ ${e.company}`).map((e) => ({
      id: uid("e_"), title: e.title, company: e.company, location: e.location ?? undefined, start: e.start ?? undefined, end: e.end ?? undefined,
      current: /present|current/i.test(e.end ?? ""), employment_type: e.employment_type ?? (/intern/i.test(e.title) ? "internship" : undefined),
      bullets: e.bullets.filter((b) => presentIn(text, b.text.slice(0, 60))).map((b) => ({ id: uid("b_"), text: b.text })),
    })),
    projects: keep(data.projects, (pr) => [pr.name], (pr) => `project: ${pr.name}`).map((pr) => ({
      id: uid("p_"), name: pr.name, technologies: pr.technologies ?? undefined, bullets: pr.bullets.map((b) => ({ id: uid("b_"), text: b.text })),
    })),
    education: keep(data.education, (e) => [e.institution], (e) => `education: ${e.institution}`).map((e) => ({
      id: uid("ed_"), degree: e.degree, field: e.field ?? undefined, institution: e.institution, start: e.start ?? undefined, end: e.end ?? undefined, grade: e.grade ?? undefined,
    })),
    skills: data.skills.map((g) => ({ category: g.category, items: g.items.filter((s) => presentIn(text, s)) })).filter((g) => g.items.length),
    certifications: keep(data.certifications, (c) => [c.name], (c) => `certification: ${c.name}`).map((c) => ({ id: uid("c_"), name: c.name, issuer: c.issuer ?? undefined, date: c.date ?? undefined })),
    achievements: data.achievements.filter((a) => presentIn(text, a.text.slice(0, 50))).map((a) => ({ id: uid("b_"), text: a.text })),
    languages: data.languages.filter((l) => presentIn(text, l.name)).map((l) => ({ name: l.name, proficiency: l.proficiency ?? undefined })),
    unknown_fields: [...new Set([...(data.unknown_fields ?? []), ...(heuristic.unknown_fields ?? [])])],
  };
  // If AI lost content the heuristic parser found, prefer the heuristic section.
  if (heuristic.experience.length > p.experience.length) p.experience = heuristic.experience;
  if (heuristic.projects.length > p.projects.length) p.projects = heuristic.projects;
  if (heuristic.education.length > p.education.length) p.education = heuristic.education;
  if (heuristic.skills.flatMap((g) => g.items).length > p.skills.flatMap((g) => g.items).length) p.skills = heuristic.skills;
  return { profile: p, dropped };
}

// ---------------------------------------------------------------------------
// Profile facts digest used by all writers
// ---------------------------------------------------------------------------
export function profileDigest(p: CareerProfile, job?: NormalizedJob, maxBullets = 14) {
  const kp = job ? jobKeywordProfile(job) : null;
  const bullets = [
    ...p.experience.flatMap((e) => e.bullets.map((b) => ({ ctx: `${e.title} at ${e.company} (${e.start ?? "?"} – ${e.end ?? "?"})`, text: b.text }))),
    ...p.projects.flatMap((pr) => pr.bullets.map((b) => ({ ctx: `Project: ${pr.name}`, text: b.text }))),
  ];
  const ranked = kp ? bullets.map((b) => ({ ...b, r: relevance(b.text, kp) })).sort((a, b) => b.r - a.r) : bullets;
  return {
    name: p.name,
    location: p.location,
    summary: p.summary,
    roles: p.experience.map((e) => `${e.title} at ${e.company} (${e.start ?? "?"} – ${e.end ?? "?"})`),
    education: p.education.map((e) => `${e.degree}${e.field ? ` in ${e.field}` : ""}, ${e.institution}${e.end ? ` (${e.end})` : ""}`),
    skills: p.skills.flatMap((g) => g.items),
    certifications: p.certifications.map((c) => c.name),
    evidence: ranked.slice(0, maxBullets).map((b) => `[${b.ctx}] ${b.text}`),
  };
}

const NO_FABRICATION = `Use ONLY facts from CANDIDATE. Do not invent employers, metrics, numbers, years of experience, tools, achievements, certifications or personal details. If something needed is unknown, write [[UNKNOWN: what is missing]] instead of guessing.`;

function extractFlags(text: string): { text: string; flags: string[] } {
  const flags = [...text.matchAll(/\[\[UNKNOWN:\s*([^\]]+)\]\]/g)].map((m) => m[1].trim());
  return { text, flags };
}

/** Reject generated prose that introduces numbers not present in the profile or job. */
export function unsupportedNumbers(generated: string, ...sources: string[]): string[] {
  const allowed = new Set((sources.join(" ").match(/\d+(?:\.\d+)?/g) ?? []).map(String));
  const nums = generated.replace(/\[\[UNKNOWN:[^\]]*\]\]/g, "").match(/\d+(?:\.\d+)?/g) ?? [];
  return [...new Set(nums.filter((n) => !allowed.has(n) && !/^(19|20)\d\d$/.test(n)))];
}

// ---------------------------------------------------------------------------
// Cover letters & outreach
// ---------------------------------------------------------------------------
export type LetterKind = "cover_letter" | "intro" | "recruiter" | "linkedin" | "email";
export type Tone = "formal" | "concise" | "professional" | "conversational" | string;

const KIND_SPEC: Record<LetterKind, string> = {
  cover_letter: "a full cover letter (250–350 words, 3–4 paragraphs, greeting + sign-off with the candidate's name)",
  intro: "a short application introduction (60–90 words) suitable for an application form text box",
  recruiter: "a recruiter message (80–120 words) asking to be considered for the role",
  linkedin: "a LinkedIn connection note (under 300 characters)",
  email: "an email application with a 'Subject:' first line, then a 150–220 word body and sign-off",
};

export async function generateLetter(
  ai: AIConfig | null,
  profile: CareerProfile,
  job: NormalizedJob,
  kind: LetterKind,
  tone: Tone,
  customInstruction?: string,
): Promise<{ content: string; flags: string[]; method: "ai" | "rules" }> {
  const digest = profileDigest(profile, job);
  if (!aiAvailable(ai)) return { ...letterTemplate(profile, job, kind), method: "rules" };
  const r = await generate(ai, {
    system: `You write job application messages. ${NO_FABRICATION}`,
    prompt: `Write ${KIND_SPEC[kind]} for this job. Tone: ${tone}.${customInstruction ? ` Extra instruction: ${customInstruction}` : ""}
Address the hiring team generically unless a named contact is in the job text. Connect 2–3 specific pieces of the candidate's real evidence to the job's needs. No clichés, no placeholders other than [[UNKNOWN: ...]].

JOB: ${job.title} at ${job.company}
${(job.description ?? "").slice(0, 5000)}

CANDIDATE: ${JSON.stringify(digest)}`,
    temperature: 0.5,
  });
  let content = r.text.trim();
  const flags = extractFlags(content).flags;
  const bad = unsupportedNumbers(content, JSON.stringify(profile), job.description ?? "", job.title);
  if (bad.length) flags.push(`Contains numbers not found in your profile (${bad.join(", ")}) — verify or remove.`);
  content = content.replace(/^```[a-z]*\n?|```$/g, "").trim();
  return { content, flags, method: "ai" };
}

/** Append a period unless the text already ends with sentence punctuation (e.g. "Pvt. Ltd."). */
const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

export function letterTemplate(p: CareerProfile, job: NormalizedJob, kind: LetterKind): { content: string; flags: string[] } {
  const kp = jobKeywordProfile(job);
  const recent = p.experience[0];
  const evidence = p.experience
    .flatMap((e) => e.bullets.map((b) => ({ e, b, r: relevance(b.text, kp) })))
    .sort((a, b) => b.r - a.r)
    .slice(0, 2);
  const { explicit, evidenced } = profileSkillSet(p);
  const matched = [...kp.skills].filter((s) => explicit.has(s) || evidenced.has(s)).slice(0, 4);
  const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1).replace(/\.$/, "");
  const flags: string[] = [];
  const role = recent ? `${recent.title} at ${recent.company}` : "";
  if (!recent) flags.push("No work experience in profile.");
  const ev = evidence.map((x) => `at ${x.e.company}, I ${lc(x.b.text)}`).join("; and ");
  const skillsLine = matched.length ? `My relevant skills include ${matched.join(", ")}.` : "";
  const edu = p.education[0] ? `${p.education[0].degree}${p.education[0].field ? ` in ${p.education[0].field}` : ""}` : "";
  switch (kind) {
    case "linkedin":
      return { content: `Hi — I'm ${p.name}${role ? `, most recently ${role}` : ""}. I'm applying for the ${job.title} role at ${job.company} and would value connecting.`.slice(0, 300), flags };
    case "intro":
      return { content: `${sentence(`I'm ${p.name}${role ? `, most recently ${role}` : ""}`)} ${ev ? sentence(`In that work, ${ev}`) : ""} ${skillsLine} I'd welcome the chance to bring this to the ${job.title} role at ${job.company}.`.replace(/\s+/g, " ").trim(), flags };
    case "recruiter":
      return { content: `Hi,\n\nI'm interested in the ${job.title} position at ${job.company}. ${role ? `I most recently worked as ${role}, where ` : ""}${evidence[0] ? sentence(`I ${lc(evidence[0].b.text)}`) : ""} ${skillsLine}\n\nCould we discuss whether my background fits what the team needs?\n\nThanks,\n${p.name}`, flags };
    case "email":
      return { content: `Subject: Application – ${job.title} – ${p.name}\n\nDear Hiring Team,\n\nI'm writing to apply for the ${job.title} role at ${job.company}. ${ev ? sentence(`Most relevant to this role: ${ev}`) : ""} ${skillsLine}${edu ? ` I hold a ${edu}.` : ""}\n\nMy tailored resume is attached. I'd be glad to discuss how I can contribute.\n\nBest regards,\n${p.name}\n${[p.phone, p.email].filter(Boolean).join(" | ")}`, flags };
    default:
      return {
        content: `Dear Hiring Team,\n\nI'm applying for the ${job.title} position at ${job.company}.${role ? ` ${sentence(`I most recently worked as ${role}`)}` : ""}\n\n${ev ? sentence(ev.charAt(0).toUpperCase() + ev.slice(1)) : ""} ${skillsLine}\n\n${edu ? `I hold a ${edu}${p.education[0]?.institution ? ` from ${p.education[0].institution}` : ""}. ` : ""}I'm drawn to this role because it matches the work I have been doing, and I would bring careful, guideline-driven attention to quality to your team.\n\nThank you for your consideration.\n\nSincerely,\n${p.name}`,
        flags,
      };
  }
}

// ---------------------------------------------------------------------------
// Application questions
// ---------------------------------------------------------------------------
export interface LibraryAnswer {
  key: string;
  question: string;
  answer: string;
  verified: boolean;
}

const QUESTION_KEYS: [RegExp, string][] = [
  [/notice period|how soon can you (join|start)|earliest start|availability to start|joining/i, "notice_period"],
  [/salary expectation|expected (salary|ctc|compensation)|desired (salary|pay)|compensation expectation/i, "salary_expectation"],
  [/current (ctc|salary|compensation)/i, "current_ctc"],
  [/authori[sz]ed to work|work authori[sz]ation|require (visa )?sponsorship|right to work|visa status/i, "work_authorization"],
  [/relocat/i, "relocation"],
  [/tell (us|me) about yourself|introduce yourself|professional background|brief introduction/i, "introduction"],
  [/career goals|where do you see yourself/i, "career_goals"],
];

export function questionKey(q: string): string | null {
  for (const [re, k] of QUESTION_KEYS) if (re.test(q)) return k;
  return null;
}

export function findLibraryAnswer(q: string, lib: LibraryAnswer[]): LibraryAnswer | null {
  const key = questionKey(q);
  if (key) {
    const hit = lib.find((l) => l.key === key && l.answer.trim());
    if (hit) return hit;
  }
  const qt = new Set(tokenize(q));
  let best: LibraryAnswer | null = null;
  let bestS = 0;
  for (const l of lib) {
    if (!l.answer.trim()) continue;
    const s = jaccard(qt, new Set(tokenize(l.question)));
    if (s > bestS) {
      bestS = s;
      best = l;
    }
  }
  return bestS >= 0.6 ? best : null;
}

export const STANDARD_QUESTIONS = [
  "Why are you applying for this role?",
  "Why do you want to work at this company?",
  "Why are you a good fit for this position?",
  "Describe your relevant experience.",
  "What is your notice period?",
  "What are your salary expectations?",
  "What are your key strengths?",
  "Describe a project you are proud of.",
  "Describe your experience with AI / LLMs.",
  "Describe your data annotation experience.",
  "Tell us about your professional background.",
];

export async function answerQuestions(
  ai: AIConfig | null,
  profile: CareerProfile,
  prefs: JobPreferences,
  library: LibraryAnswer[],
  job: NormalizedJob,
  questions: string[],
): Promise<{ question: string; answer: string; source: "library" | "profile" | "ai" | "rules"; flags: string[] }[]> {
  const out: { question: string; answer: string; source: "library" | "profile" | "ai" | "rules"; flags: string[] }[] = [];
  const open: string[] = [];
  for (const q of questions) {
    const lib = findLibraryAnswer(q, library);
    if (lib) {
      out.push({ question: q, answer: lib.answer, source: "library", flags: lib.verified ? [] : ["Library answer not marked verified"] });
      continue;
    }
    const key = questionKey(q);
    const prefVal = key === "notice_period" ? prefs.notice_period : key === "salary_expectation" ? prefs.expected_salary : key === "work_authorization" ? prefs.work_authorization : null;
    if (key && ["notice_period", "salary_expectation", "work_authorization", "current_ctc", "relocation"].includes(key)) {
      out.push(prefVal ? { question: q, answer: prefVal, source: "profile", flags: [] } : { question: q, answer: "", source: "profile", flags: [`Unknown: add your ${key.replace(/_/g, " ")} in Settings → Answer library`] });
      continue;
    }
    open.push(q);
  }
  if (!open.length) return out;
  if (!aiAvailable(ai)) {
    for (const q of open) out.push({ question: q, ...answerTemplate(q, profile, job), source: "rules" });
    return out;
  }
  const digest = profileDigest(profile, job, 18);
  const schema = z.object({ answers: z.array(z.object({ question: z.string(), answer: z.string(), unknown: z.array(z.string()).nullish() })) });
  const { data } = await generateJson(ai, {
    system: `You answer job application questions in first person for the candidate. ${NO_FABRICATION} Keep each answer 60–140 words unless the question is a short factual one. If the question needs information you do not have (e.g. specifics about the company that are not in the job text), say only what is supported and add the gap to "unknown".`,
    prompt: `Return JSON {"answers":[{"question","answer","unknown":[]}]} for these questions, in order:
${open.map((q, i) => `${i + 1}. ${q}`).join("\n")}

JOB: ${job.title} at ${job.company}
${(job.description ?? "").slice(0, 4000)}

CANDIDATE: ${JSON.stringify(digest)}`,
    temperature: 0.35,
  }, schema);
  open.forEach((q, i) => {
    const a = data.answers[i] ?? data.answers.find((x) => normalize(x.question) === normalize(q));
    if (!a) {
      out.push({ question: q, ...answerTemplate(q, profile, job), source: "rules" });
      return;
    }
    const flags = [...(a.unknown ?? []), ...extractFlags(a.answer).flags];
    const bad = unsupportedNumbers(a.answer, JSON.stringify(profile), job.description ?? "");
    if (bad.length) flags.push(`Numbers not in profile: ${bad.join(", ")}`);
    out.push({ question: q, answer: a.answer.trim(), source: "ai", flags });
  });
  return out;
}

export function answerTemplate(q: string, p: CareerProfile, job: NormalizedJob): { answer: string; flags: string[] } {
  const kp = jobKeywordProfile({ ...job, description: `${job.description ?? ""} ${q}` });
  const best = p.experience
    .flatMap((e) => e.bullets.map((b) => ({ e, b, r: relevance(`${q} ${b.text}`, kp) })))
    .sort((a, b) => b.r - a.r)
    .slice(0, 2);
  const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1).replace(/\.$/, "");
  const ev = best.map((x) => sentence(`As ${x.e.title} at ${x.e.company}, I ${lc(x.b.text)}`)).join(" ");
  const { explicit, evidenced } = profileSkillSet(p);
  const matched = [...kp.skills].filter((s) => explicit.has(s) || evidenced.has(s)).slice(0, 4);
  if (/company|why .*work (here|at)/i.test(q))
    return { answer: `The ${job.title} role at ${job.company} lines up directly with the work I have been doing${matched.length ? ` in ${matched.join(", ")}` : ""}.`, flags: [`Add something specific you value about ${job.company} — that isn't in your profile.`] };
  if (/why .*(apply|applying|role|position|interested)/i.test(q))
    return { answer: `I'm applying because this role matches my recent experience. ${ev}`.trim(), flags: [] };
  if (/fit|suitable|good match|qualif/i.test(q))
    return { answer: `${matched.length ? `My skills in ${matched.join(", ")} map to what this role needs. ` : ""}${ev}`.trim(), flags: [] };
  if (/project/i.test(q)) {
    const pr = p.projects[0];
    return pr ? { answer: `${pr.name}: ${pr.bullets.map((b) => b.text).join(" ")}`, flags: [] } : { answer: "", flags: ["No projects in profile."] };
  }
  if (/strength/i.test(q)) {
    const skills = p.skills.flatMap((g) => g.items).filter((s) => kp.skills.has(s) || extractSkills(s).some((x) => kp.skills.has(x))).slice(0, 4);
    return { answer: `${skills.length ? `My strengths for this role are ${skills.join(", ")}. ` : ""}${ev}`.trim(), flags: [] };
  }
  return { answer: ev || p.summary, flags: ev ? [] : ["Could not find specific matching experience."] };
}

// ---------------------------------------------------------------------------
// Job analysis narrative (optional AI on top of deterministic score)
// ---------------------------------------------------------------------------
export const JobAnalysisZ = z.object({
  summary: z.string(),
  required_skills: z.array(z.string()).default([]),
  preferred_skills: z.array(z.string()).default([]),
  responsibilities: z.array(z.string()).default([]),
  fit_notes: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  red_flags: z.array(z.string()).default([]),
});
export type JobAnalysis = z.infer<typeof JobAnalysisZ>;

export async function analyzeJobAI(ai: AIConfig, profile: CareerProfile, job: NormalizedJob): Promise<JobAnalysis> {
  const { data } = await generateJson(ai, {
    system: `You analyse job postings for a candidate. Be specific and honest about gaps. ${NO_FABRICATION}`,
    prompt: `Return JSON {summary (2 sentences on what the job really is), required_skills[], preferred_skills[], responsibilities[] (max 6), fit_notes[] (how the candidate's REAL evidence maps), gaps[] (requirements the candidate does not evidence), red_flags[] (e.g. unpaid trial, vague pay, fee requests, location restrictions)}.

JOB: ${job.title} at ${job.company} (${job.location ?? "location n/a"})
${(job.description ?? "").slice(0, 7000)}

CANDIDATE: ${JSON.stringify(profileDigest(profile, job))}`,
    temperature: 0.2,
  }, JobAnalysisZ);
  return data;
}

// ---------------------------------------------------------------------------
// Interview prep
// ---------------------------------------------------------------------------
export interface InterviewPrep {
  company_overview: string;
  role_overview: string;
  jd_analysis: string[];
  preparation_guide: string[];
  relevant_experience: string[];
  likely_questions: string[];
  behavioral_questions: { question: string; suggested_answer: string }[];
  technical_questions: { question: string; suggested_answer: string }[];
  questions_to_ask: string[];
  checklist: string[];
  sources: { title: string; url: string }[];
  verified_facts: string[];
  inferred: string[];
  method: "ai" | "rules";
}

const PrepZ = z.object({
  company_overview: z.string(),
  role_overview: z.string(),
  jd_analysis: z.array(z.string()),
  preparation_guide: z.array(z.string()),
  relevant_experience: z.array(z.string()),
  likely_questions: z.array(z.string()),
  behavioral_questions: z.array(z.object({ question: z.string(), suggested_answer: z.string() })),
  technical_questions: z.array(z.object({ question: z.string(), suggested_answer: z.string() })),
  questions_to_ask: z.array(z.string()),
  checklist: z.array(z.string()),
});

export async function interviewPrep(ai: AIConfig | null, profile: CareerProfile, job: NormalizedJob, company?: CompanyIntel | null): Promise<InterviewPrep> {
  const digest = profileDigest(profile, job, 16);
  if (!aiAvailable(ai)) return interviewPrepRules(profile, job, company);
  const { data } = await generateJson(ai, {
    system: `You are an interview coach. Suggested answers must be built ONLY from the candidate's real evidence, in STAR form where relevant. ${NO_FABRICATION} The company overview must use only the COMPANY facts provided or the job text; otherwise say it is unknown.`,
    prompt: `Return JSON with keys company_overview, role_overview, jd_analysis[], preparation_guide[], relevant_experience[], likely_questions[], behavioral_questions[{question,suggested_answer}], technical_questions[{question,suggested_answer}] (empty if non-technical), questions_to_ask[], checklist[].

JOB: ${job.title} at ${job.company}
${(job.description ?? "").slice(0, 6000)}

COMPANY FACTS: ${JSON.stringify(company?.verified ?? [])}

CANDIDATE: ${JSON.stringify(digest)}`,
    temperature: 0.35,
  }, PrepZ);
  return { ...data, sources: company?.sources ?? [], verified_facts: company?.verified.map((v) => v.fact) ?? [], inferred: company?.inferred ?? [], method: "ai" };
}

export function interviewPrepRules(p: CareerProfile, job: NormalizedJob, company?: CompanyIntel | null): InterviewPrep {
  const kp = jobKeywordProfile(job);
  const lines = (job.description ?? "").split(/\n|•/).map((l) => l.trim()).filter((l) => l.length > 25);
  const reqs = lines.filter((l) => /(require|must|should|experience|you will|responsib|ability|proficien)/i.test(l)).slice(0, 8);
  const ev = p.experience.flatMap((e) => e.bullets.map((b) => ({ e, b, r: relevance(b.text, kp) }))).sort((a, b) => b.r - a.r).slice(0, 5);
  const isAI = [...kp.skills].some((s) => ["LLM Evaluation", "Data Annotation", "RLHF", "Prompt Engineering", "Generative AI"].includes(s));
  return {
    company_overview: company?.summary ?? `Company details not researched yet — run Company Intelligence for ${job.company}.`,
    role_overview: `${job.title} at ${job.company}${job.location ? ` (${job.location})` : ""}.`,
    jd_analysis: reqs,
    preparation_guide: [
      "Re-read the job description and map each requirement to one real example from your experience.",
      "Prepare a 60-second introduction based on your most recent role.",
      ...(isAI ? ["Be ready to evaluate a sample AI response live: check factuality, instruction-following, safety and tone, and explain your reasoning.", "Review rating scales (e.g. Likert / side-by-side preference) and how you justify a rating in writing."] : []),
      "Prepare 2–3 STAR stories from the experience listed below.",
    ],
    relevant_experience: ev.map((x) => `${x.e.title} @ ${x.e.company}: ${x.b.text}`),
    likely_questions: [
      "Walk me through your background.",
      `Why do you want this ${job.title} role?`,
      ...(isAI ? ["How do you decide whether an AI response is factually accurate?", "How do you stay consistent when guidelines are ambiguous?", "How do you balance speed and accuracy against productivity targets?"] : []),
      "What would you do in your first 30 days?",
    ],
    behavioral_questions: [
      { question: "Tell me about a time you found a quality issue others missed.", suggested_answer: ev[0] ? `Situation/Task: In my role as ${ev[0].e.title} at ${ev[0].e.company}. Action: ${ev[0].b.text} Result: [[UNKNOWN: add the concrete outcome you remember]]` : "" },
      { question: "Describe working with a team to meet a quality standard.", suggested_answer: ev[1] ? `${ev[1].b.text} [[UNKNOWN: add a specific example and outcome]]` : "" },
    ],
    technical_questions: [],
    questions_to_ask: [
      "How is quality measured for this role, and what does a strong first quarter look like?",
      "What guidelines or tooling will I be working with?",
      "How does feedback flow between evaluators and the model/research team?",
      "What are the working hours / time-zone expectations?",
    ],
    checklist: ["Test camera, mic and internet", "Keep tailored resume open", "Prepare questions to ask", "Note interviewer names", "Send a thank-you note within 24 hours"],
    sources: company?.sources ?? [],
    verified_facts: company?.verified.map((v) => v.fact) ?? [],
    inferred: company?.inferred ?? [],
    method: "rules",
  };
}

// ---------------------------------------------------------------------------
// Company intelligence (grounded; verified vs inferred)
// ---------------------------------------------------------------------------
export interface CompanyIntel {
  name: string;
  summary: string;
  website: string | null;
  industry: string | null;
  products: string[];
  recent_news: string[];
  hiring_trends: string[];
  interview_process: string[];
  verified: { fact: string; source: string }[];
  inferred: string[];
  sources: { title: string; url: string }[];
  researched_at: string;
  method: "ai-grounded" | "ai" | "job-text";
}

const IntelZ = z.object({
  summary: z.string(),
  website: z.string().nullish(),
  industry: z.string().nullish(),
  products: z.array(z.string()).default([]),
  recent_news: z.array(z.string()).default([]),
  hiring_trends: z.array(z.string()).default([]),
  interview_process: z.array(z.string()).default([]),
  verified: z.array(z.object({ fact: z.string(), source: z.string() })).default([]),
  inferred: z.array(z.string()).default([]),
});

export async function companyIntel(ai: AIConfig | null, name: string, jobsText: string, grounded: boolean): Promise<CompanyIntel> {
  const base: CompanyIntel = {
    name, summary: "", website: null, industry: null, products: [], recent_news: [], hiring_trends: [], interview_process: [],
    verified: [], inferred: [], sources: [], researched_at: new Date().toISOString(), method: "job-text",
  };
  if (!aiAvailable(ai)) {
    return { ...base, summary: `No AI configured. From your saved listings, ${name} is hiring for: ${jobsText.split("\n").filter((l) => l.startsWith("TITLE:")).map((l) => l.slice(6).trim()).slice(0, 5).join(", ") || "—"}.`, inferred: ["Based only on job listings you've collected."] };
  }
  const useGrounding = grounded && ai.provider === "gemini";
  const prompt = `Research the company "${name}" for a job seeker. Return JSON: {summary, website, industry, products[], recent_news[] (with month/year), hiring_trends[], interview_process[], verified[{fact, source}] (only facts you can attribute to a source URL), inferred[] (anything not directly sourced, clearly labelled as inference)}.
If you cannot verify something, put it in inferred or omit it. Never present guesses as facts.

Job listings from this company that the candidate collected:
${jobsText.slice(0, 4000)}`;
  if (useGrounding) {
    const r = await generate(ai, { prompt, grounded: true, temperature: 0.1 });
    const { parseJsonLoose } = await import("./provider");
    const parsed = IntelZ.safeParse(parseJsonLoose(r.text));
    if (parsed.success) {
      const urls = new Set(r.sources.map((s) => s.url));
      // keep "verified" only when the model cited a source we actually received, or the cited domain matches a source title
      const verified = parsed.data.verified.filter((v) => urls.has(v.source) || r.sources.some((s) => v.source && (s.title.includes(v.source) || v.source.includes(s.title))));
      const demoted = parsed.data.verified.filter((v) => !verified.includes(v)).map((v) => `${v.fact} (source not confirmed)`);
      return { ...base, ...parsed.data, website: parsed.data.website ?? null, industry: parsed.data.industry ?? null, verified, inferred: [...parsed.data.inferred, ...demoted], sources: r.sources, method: "ai-grounded" };
    }
  }
  const { data } = await generateJson(ai, { prompt: prompt + "\nYou have no web access: put everything not in the job listings under inferred and leave verified empty.", temperature: 0.1 }, IntelZ);
  return { ...base, ...data, website: data.website ?? null, industry: data.industry ?? null, verified: [], inferred: [...data.inferred, ...data.verified.map((v) => `${v.fact} (unverified)`)], method: "ai" };
}
