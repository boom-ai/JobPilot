// Resume tailoring with hard truth guards.
//
// Two layers:
//  1. Rules (always): rank & reorder real content by relevance to the job; never rewrites text.
//  2. AI (optional): rewrites wording of existing bullets/summary. Every AI output is validated:
//     - bullets must reference a real source bullet id
//     - no numbers/metrics that are not in the source bullet
//     - no skills/tools that the source bullet (or profile) does not evidence
//     - employers, titles, dates, education, certifications are always copied from the profile
//     Anything that fails validation is reverted to the original text and reported.

import { z } from "zod";
import type { CareerProfile, NormalizedJob } from "../types";
import { extractSkills, profileSkillSet, canonicalSkill } from "../skills";
import { jaccard, normalize, tokenize } from "../text";
import { generateJson, aiAvailable, type AIConfig } from "../ai/provider";

export interface TailoredBullet {
  source_id: string;
  text: string;
  original: string;
  changed: boolean;
  relevance: number;
}

export interface TailoredResume {
  header: { name: string; email: string; phone: string; location: string; links: { label: string; url: string }[] };
  headline?: string;
  summary: string;
  summary_original: string;
  skills: { category: string; items: string[] }[];
  experience: { id: string; title: string; company: string; location?: string; start?: string; end?: string; bullets: TailoredBullet[] }[];
  projects: { id: string; name: string; technologies?: string[]; bullets: TailoredBullet[] }[];
  education: CareerProfile["education"];
  certifications: CareerProfile["certifications"];
  achievements: CareerProfile["achievements"];
  languages: CareerProfile["languages"];
  section_order: SectionName[];
  hidden_sections: SectionName[];
  keywords: { matched: string[]; not_claimed: string[] };
  warnings: string[];
  changes: string[];
  job: { title: string; company: string };
}

export type SectionName = "summary" | "skills" | "experience" | "projects" | "education" | "certifications" | "achievements" | "languages";
export const ALL_SECTIONS: SectionName[] = ["summary", "skills", "experience", "projects", "education", "certifications", "achievements", "languages"];

const NUM_RE = /\d+(?:[.,]\d+)?\s*%?|\b(one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|dozens?)\b/gi;

function numbersIn(s: string): Set<string> {
  return new Set([...s.matchAll(NUM_RE)].map((m) => m[0].toLowerCase().replace(/\s+/g, "").replace(",", "")));
}

export function jobKeywordProfile(job: NormalizedJob) {
  const text = `${job.title}\n${job.description ?? ""}\n${(job.tags ?? []).join(" ")}`;
  const skills = new Set(extractSkills(text));
  const tokens = new Set(tokenize(text));
  return { skills, tokens, text };
}

export function relevance(text: string, kp: ReturnType<typeof jobKeywordProfile>): number {
  const sk = extractSkills(text);
  const skillHits = sk.filter((s) => kp.skills.has(s)).length;
  const tokSim = jaccard(new Set(tokenize(text)), kp.tokens);
  return Math.round((skillHits * 0.6 + tokSim * 8) * 100) / 100;
}

export function makeFileName(job: { company: string; title: string }, date = new Date()): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
  return `${clean(job.company)}_${clean(job.title)}_Resume_${date.toISOString().slice(0, 10)}`;
}

/** Layer 1 — deterministic tailoring. */
export function tailorWithRules(profile: CareerProfile, job: NormalizedJob): TailoredResume {
  const kp = jobKeywordProfile(job);
  const changes: string[] = [];
  const { explicit, evidenced } = profileSkillSet(profile);
  const have = new Set([...explicit, ...evidenced]);

  const rankBullets = (bs: { id: string; text: string }[], keepMin: number, dropIrrelevant: boolean) => {
    const ranked = bs.map((b, i) => ({ b, i, r: relevance(b.text, kp) }));
    const sorted = [...ranked].sort((a, b) => b.r - a.r || a.i - b.i);
    let kept = sorted;
    if (dropIrrelevant && sorted.length > keepMin) {
      kept = sorted.filter((x, idx) => idx < keepMin || x.r > 0.15);
    }
    return kept.map((x) => ({ source_id: x.b.id, text: x.b.text, original: x.b.text, changed: false, relevance: x.r }));
  };

  const experience = profile.experience.map((e) => {
    const bullets = rankBullets(e.bullets, 3, e.bullets.length > 4);
    if (bullets.length < e.bullets.length) changes.push(`${e.company}: kept the ${bullets.length} most relevant of ${e.bullets.length} bullets.`);
    if (bullets.some((b, i) => b.source_id !== e.bullets[i]?.id)) changes.push(`${e.company}: reordered bullets to lead with the most relevant work.`);
    return { id: e.id, title: e.title, company: e.company, location: e.location, start: e.start, end: e.end, bullets };
  });

  const projRanked = profile.projects
    .map((p, i) => ({ p, i, r: relevance(`${p.name} ${(p.technologies ?? []).join(" ")} ${p.bullets.map((b) => b.text).join(" ")}`, kp) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  const keepProjects = projRanked.filter((x, idx) => idx < 3 || x.r > 0.5).slice(0, 4);
  if (keepProjects.length < profile.projects.length) changes.push(`Projects: kept ${keepProjects.length} most relevant of ${profile.projects.length}.`);
  const projects = keepProjects.map(({ p }) => ({
    id: p.id,
    name: p.name,
    technologies: p.technologies,
    bullets: p.bullets.map((b) => ({ source_id: b.id, text: b.text, original: b.text, changed: false, relevance: relevance(b.text, kp) })),
  }));

  // Skills: matched first, categories with most matches first. Never adds a skill.
  const skills = profile.skills
    .map((g) => {
      const items = [...g.items].sort((a, b) => Number(kp.skills.has(canonicalSkill(b))) - Number(kp.skills.has(canonicalSkill(a))));
      return { category: g.category, items, hits: items.filter((s) => kp.skills.has(canonicalSkill(s))).length };
    })
    .sort((a, b) => b.hits - a.hits)
    .map(({ category, items }) => ({ category, items }));
  if (skills[0] && skills[0].category !== profile.skills[0]?.category) changes.push(`Skills: moved “${skills[0].category}” to the top.`);

  // Summary: reorder existing sentences by relevance (no rewriting in rules mode)
  const sentences = profile.summary.split(/(?<=[.!?])\s+/).filter(Boolean);
  const summary = [...sentences]
    .map((s, i) => ({ s, i, r: relevance(s, kp) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.s)
    .join(" ");
  if (summary !== profile.summary) changes.push("Summary: led with the sentences most relevant to this role.");

  const matched = [...kp.skills].filter((s) => have.has(s));
  const notClaimed = [...kp.skills].filter((s) => !have.has(s));

  // Section order: experience-heavy vs skills-forward
  const section_order: SectionName[] = ["summary", "skills", "experience", "projects", "education", "certifications", "achievements", "languages"];
  const aiCerts = profile.certifications.filter((c) => relevance(c.name, kp) > 0.2);
  if (aiCerts.length && profile.experience.length <= 2) {
    // early-career: surface relevant certifications before projects
    section_order.splice(section_order.indexOf("certifications"), 1);
    section_order.splice(section_order.indexOf("projects"), 0, "certifications");
    changes.push("Moved relevant certifications above projects.");
  }

  return {
    header: { name: profile.name, email: profile.email, phone: profile.phone, location: profile.location, links: profile.links },
    summary,
    summary_original: profile.summary,
    skills,
    experience,
    projects,
    education: profile.education,
    certifications: profile.certifications,
    achievements: profile.achievements,
    languages: profile.languages,
    section_order,
    hidden_sections: [],
    keywords: { matched, not_claimed: notClaimed },
    warnings: notClaimed.length ? [`Not added because they are not in your profile: ${notClaimed.join(", ")}.`] : [],
    changes,
    job: { title: job.title, company: job.company },
  };
}

// ---------------------------------------------------------------------------
// Layer 2 — AI rewriting with validation
// ---------------------------------------------------------------------------
const AIRewriteSchema = z.object({
  headline: z.string().max(120).optional().nullable(),
  summary: z.string().max(1200),
  bullets: z.array(z.object({ source_id: z.string(), text: z.string().max(400) })),
  skill_order: z.array(z.string()).optional().nullable(),
  notes: z.array(z.string()).optional().nullable(),
});

export interface ValidationIssue {
  source_id: string | "summary";
  reason: string;
  rejected: string;
}

/** Validate one rewritten bullet against its source. Returns a reason when it must be rejected. */
export function validateRewrite(source: string, rewrite: string, allowedSkills: Set<string>): string | null {
  const srcNums = numbersIn(source);
  for (const n of numbersIn(rewrite)) if (!srcNums.has(n)) return `introduced number/metric “${n}”`;
  const srcSkills = new Set(extractSkills(source));
  for (const s of extractSkills(rewrite)) if (!srcSkills.has(s) && !allowedSkills.has(s)) return `introduced skill “${s}” not evidenced in this bullet`;
  if (rewrite.length > Math.max(source.length * 1.8, 260)) return "rewrite much longer than source";
  // Must stay about the same thing: some lexical anchor to the source
  const anchor = jaccard(new Set(tokenize(source)), new Set(tokenize(rewrite)));
  if (anchor < 0.12) return "rewrite does not describe the same work";
  return null;
}

export async function tailorResume(
  profile: CareerProfile,
  job: NormalizedJob,
  ai: AIConfig | null,
  opts: { tone?: "concise" | "balanced" | "detailed" } = {},
): Promise<{ resume: TailoredResume; method: "ai" | "rules"; issues: ValidationIssue[] }> {
  const base = tailorWithRules(profile, job);
  if (!aiAvailable(ai)) return { resume: base, method: "rules", issues: [] };

  const sourceBullets = new Map<string, { text: string; ctx: string }>();
  for (const e of profile.experience) for (const b of e.bullets) sourceBullets.set(b.id, { text: b.text, ctx: `${e.title} @ ${e.company}` });
  for (const p of profile.projects) for (const b of p.bullets) sourceBullets.set(b.id, { text: b.text, ctx: `Project: ${p.name}` });
  const { explicit, evidenced } = profileSkillSet(profile);
  const profileSkills = new Set([...explicit, ...evidenced]);

  const input = {
    job: { title: job.title, company: job.company, description: (job.description ?? "").slice(0, 7000) },
    candidate_summary: profile.summary,
    candidate_skills: profile.skills,
    bullets: [...sourceBullets.entries()].map(([id, v]) => ({ id, context: v.ctx, text: v.text })),
  };

  const system = `You tailor resumes for ATS and recruiters. ABSOLUTE RULES:
- You may only rephrase, tighten and re-emphasise facts that are present in the candidate data.
- Never add employers, titles, dates, tools, skills, certifications, metrics or numbers that are not in the specific source bullet.
- Never claim responsibilities from the job description that the source bullet does not describe.
- Use job keywords only where the source bullet genuinely describes that thing.
- Keep each bullet one sentence, starting with a strong past-tense verb.`;
  const toneHint = { concise: "Keep bullets under 22 words.", balanced: "Keep bullets under 30 words.", detailed: "Bullets may be up to 38 words." }[opts.tone ?? "balanced"];
  const prompt = `Tailor this candidate's resume wording for the job. ${toneHint}
Return JSON: {"headline": string (optional, built only from candidate's real titles/skills), "summary": string (3 sentences max, only facts in candidate_summary/skills), "bullets": [{"source_id": string, "text": string}] (rewrite EVERY bullet you consider relevant; omit irrelevant ones), "skill_order": [skills from candidate_skills, most relevant first], "notes": [short notes on what you emphasised]}

DATA:
${JSON.stringify(input)}`;

  let data: z.infer<typeof AIRewriteSchema>;
  try {
    ({ data } = await generateJson(ai, { system, prompt, temperature: 0.25 }, AIRewriteSchema));
  } catch (e) {
    return { resume: { ...base, warnings: [...base.warnings, `AI rewrite unavailable (${(e as Error).message.slice(0, 120)}); used rule-based tailoring.`] }, method: "rules", issues: [] };
  }

  const issues: ValidationIssue[] = [];
  const rewrites = new Map<string, string>();
  for (const b of data.bullets) {
    const src = sourceBullets.get(b.source_id);
    if (!src) {
      issues.push({ source_id: b.source_id, reason: "unknown source bullet (possible fabrication)", rejected: b.text });
      continue;
    }
    const reason = validateRewrite(src.text, b.text, new Set());
    if (reason) issues.push({ source_id: b.source_id, reason, rejected: b.text });
    else rewrites.set(b.source_id, b.text.trim());
  }

  const applyRewrites = (bs: TailoredBullet[]) =>
    bs.map((b) => {
      const r = rewrites.get(b.source_id);
      return r && r !== b.original ? { ...b, text: r, changed: true } : b;
    });
  const resume: TailoredResume = {
    ...base,
    experience: base.experience.map((e) => ({ ...e, bullets: applyRewrites(e.bullets) })),
    projects: base.projects.map((p) => ({ ...p, bullets: applyRewrites(p.bullets) })),
  };

  // summary validation: no new numbers; skills must be in profile
  const sumReason = (() => {
    const srcNums = numbersIn(profile.summary + " " + [...sourceBullets.values()].map((v) => v.text).join(" "));
    for (const n of numbersIn(data.summary)) if (!srcNums.has(n)) return `introduced number “${n}”`;
    for (const s of extractSkills(data.summary)) if (!profileSkills.has(s)) return `claims skill “${s}” not in profile`;
    if (/\b(\d+\+?\s*years?|years of experience)\b/i.test(data.summary) && !/\byears?\b/i.test(profile.summary)) return "claims years of experience";
    return null;
  })();
  if (sumReason) issues.push({ source_id: "summary", reason: sumReason, rejected: data.summary });
  else if (data.summary.trim()) {
    resume.summary = data.summary.trim();
    resume.changes = [...resume.changes.filter((c) => !c.startsWith("Summary")), "Summary: rewritten to emphasise relevant, verified experience."];
  }
  if (data.headline && !extractSkills(data.headline).some((s) => !profileSkills.has(s))) resume.headline = data.headline.trim();

  if (data.skill_order?.length) {
    const order = data.skill_order.map((s) => normalize(s));
    resume.skills = resume.skills.map((g) => ({
      ...g,
      items: [...g.items].sort((a, b) => {
        const ia = order.indexOf(normalize(a));
        const ib = order.indexOf(normalize(b));
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      }),
    }));
  }

  const changedCount = [...resume.experience, ...resume.projects].flatMap((x) => x.bullets).filter((b) => b.changed).length;
  if (changedCount) resume.changes.push(`Reworded ${changedCount} bullet${changedCount === 1 ? "" : "s"} for clarity and keyword alignment (facts unchanged).`);
  if (issues.length) resume.warnings.push(`${issues.length} AI suggestion${issues.length === 1 ? " was" : "s were"} rejected by the truth check and the original text was kept.`);
  return { resume, method: "ai", issues };
}

/** Word-level diff for the comparison view. */
export function wordDiff(a: string, b: string): { type: "same" | "add" | "del"; text: string }[] {
  const A = a.split(/(\s+)/);
  const B = b.split(/(\s+)/);
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { type: "same" | "add" | "del"; text: string }[] = [];
  let i = 0;
  let j = 0;
  const push = (type: "same" | "add" | "del", text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push("same", A[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push("del", A[i++]);
    else push("add", B[j++]);
  }
  while (i < n) push("del", A[i++]);
  while (j < m) push("add", B[j++]);
  return out;
}
