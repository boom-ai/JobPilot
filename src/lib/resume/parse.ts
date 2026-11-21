// Heuristic resume parser: plain text → CareerProfile.
// Used as the no-AI path and as a fallback / cross-check for AI extraction.
// It never invents data: anything it cannot find is listed in `unknown_fields`.

import type { Bullet, CareerProfile, EducationItem, ExperienceItem, ProjectItem } from "../types";
import { uid } from "../text";

const SECTION_PATTERNS: [RegExp, SectionKey][] = [
  [/^(professional |career |executive )?(summary|profile|objective|about me)$/i, "summary"],
  [/^(professional |work |employment |relevant )?(experience|history|employment)( history)?$/i, "experience"],
  [/^(independent |academic |personal |key |selected |side )?(&\s*)?(academic & personal )?projects?( & technical consulting| and technical consulting)?$/i, "projects"],
  [/^independent projects.*$/i, "projects"],
  [/^academic & personal projects$/i, "projects"],
  [/^education( & training| and training)?$/i, "education"],
  [/^(technical |core |key )?skills( & tools| and tools)?$|^technical skills$|^core competencies$/i, "skills"],
  [/^certifications?( & courses| and courses)?$|^licenses? (&|and) certifications$/i, "certifications"],
  [/^(achievements|awards|honors|honours|accomplishments)( & awards| and awards)?$/i, "achievements"],
  [/^languages?$/i, "languages"],
];

type SectionKey = "summary" | "experience" | "projects" | "education" | "skills" | "certifications" | "achievements" | "languages" | "header";

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE = `(?:${MONTH}\\s+\\d{4}|\\d{1,2}\\/\\d{4}|\\d{4})`;
const DATE_RANGE = new RegExp(`(${DATE})\\s*(?:–|—|-|to)\\s*(${DATE}|present|current|now|ongoing)`, "i");
const BULLET = /^\s*[•\-*▪◦●‣·]\s+/;

function sectionOf(line: string): SectionKey | null {
  const clean = line.trim().replace(/[:：]$/, "");
  if (clean.length > 50) return null;
  for (const [re, key] of SECTION_PATTERNS) if (re.test(clean)) return key;
  return null;
}

/** Join PDF hard-wrapped lines: hyphenated breaks and bullet continuations. */
function unwrap(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) {
      out.push("");
      continue;
    }
    const prev = out[out.length - 1];
    const isNewItem = BULLET.test(line) || sectionOf(line) || DATE_RANGE.test(line);
    if (prev && !isNewItem && BULLET.test(prev) && !/[.!?:]$/.test(prev)) {
      out[out.length - 1] = joinWrapped(prev, line);
    } else if (prev && !isNewItem && /-$/.test(prev) && /^[a-z]/.test(line)) {
      out[out.length - 1] = joinWrapped(prev, line);
    } else if (prev && !isNewItem && BULLET.test(prev) && /^[a-z(]/.test(line)) {
      out[out.length - 1] = joinWrapped(prev, line);
    } else {
      out.push(line);
    }
  }
  return out;
}

function joinWrapped(a: string, b: string): string {
  if (/[a-z]-$/.test(a) && /^[a-z]/.test(b)) {
    // "as-" + "surance" → "assurance", but keep real hyphenated words like "front-end"
    const head = a.slice(0, -1);
    const lastWord = head.split(/\s+/).pop() ?? "";
    const firstWord = b.split(/\s+/)[0] ?? "";
    const keepHyphen = /^(end|based|oriented|level|time|first|on|up|in|solving|commerce|generated|facing|driven|making)/.test(firstWord) && lastWord.length > 2;
    return keepHyphen ? `${a}${b}` : `${head}${b}`;
  }
  return `${a} ${b}`;
}

function stripBullet(s: string): string {
  return s.replace(BULLET, "").trim();
}

function bullets(lines: string[]): Bullet[] {
  return lines.filter((l) => l.trim()).map((l) => ({ id: uid("b_"), text: stripBullet(l) }));
}

export function parseResumeText(text: string): CareerProfile {
  const rawLines = text.replace(/\r/g, "").split("\n");
  const lines = unwrap(rawLines).filter((l) => !/^\d{1,2}$/.test(l.trim())); // drop page numbers

  const sections: Record<SectionKey, string[]> = {
    header: [], summary: [], experience: [], projects: [], education: [], skills: [], certifications: [], achievements: [], languages: [],
  };
  let current: SectionKey = "header";
  let projectsSeen = 0;
  for (const line of lines) {
    const sec = sectionOf(line);
    if (sec) {
      current = sec;
      if (sec === "projects") {
        projectsSeen++;
        if (projectsSeen > 1) sections.projects.push("");
      }
      continue;
    }
    sections[current].push(line);
  }

  const unknown: string[] = [];
  const all = text;
  const email = /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(all)?.[0] ?? "";
  const phone = /(\+?\d{1,3}[-\s]?)?\(?\d{3,5}\)?[-\s]?\d{3,4}[-\s]?\d{3,4}/.exec(all.replace(email, ""))?.[0]?.trim() ?? "";
  const headerLines = sections.header.filter((l) => l.trim());
  const name = headerLines.find((l) => !/[@\d]/.test(l) && l.split(" ").length <= 5 && /^[A-Za-z .'-]+$/.test(l))?.trim() ?? "";
  let location = "";
  for (const l of headerLines) {
    for (const part of l.split(/\s*[—|•·]\s*|\s+-\s+/)) {
      if (/,/.test(part) && !/[@\d]/.test(part) && part.length < 60) {
        location = part.trim();
        break;
      }
    }
    if (location) break;
  }
  const links: { label: string; url: string }[] = [];
  for (const m of all.matchAll(/https?:\/\/[^\s)]+|(?:www\.)?(?:linkedin\.com|github\.com)\/[^\s)]+/gi)) {
    const url = m[0].startsWith("http") ? m[0] : `https://${m[0]}`;
    links.push({ label: /linkedin/i.test(url) ? "LinkedIn" : /github/i.test(url) ? "GitHub" : "Website", url });
  }
  if (!name) unknown.push("name");
  if (!email) unknown.push("email");
  if (!phone) unknown.push("phone");
  if (!location) unknown.push("location");
  if (/linkedin/i.test(headerLines.join(" ")) && !links.some((l) => l.label === "LinkedIn")) unknown.push("LinkedIn URL");
  if (/github/i.test(headerLines.join(" ")) && !links.some((l) => l.label === "GitHub")) unknown.push("GitHub URL");

  const summary = sections.summary.filter(Boolean).join(" ").trim();
  if (!summary) unknown.push("summary");

  const experience = parseExperience(sections.experience);
  const projects = parseProjects(sections.projects);
  const education = parseEducation(sections.education);
  const skills = parseSkills(sections.skills);
  const certifications = sections.certifications
    .filter((l) => l.trim())
    .map((l) => {
      const t = stripBullet(l);
      const [nm, issuer] = t.split(/\s+[–—-]\s+/);
      return { id: uid("c_"), name: nm.trim(), issuer: issuer?.trim() };
    });
  const achievements = bullets(sections.achievements);
  const languages = sections.languages
    .filter((l) => l.trim())
    .map((l) => {
      const [nm, prof] = stripBullet(l).split(/\s+[–—-]\s+|:\s*/);
      return { name: nm.trim(), proficiency: prof?.trim() };
    });

  return {
    name,
    email,
    phone,
    location,
    links,
    summary,
    experience,
    projects,
    education,
    skills,
    certifications,
    achievements,
    languages,
    unknown_fields: unknown,
  };
}

function parseExperience(lines: string[]): ExperienceItem[] {
  const items: ExperienceItem[] = [];
  let cur: ExperienceItem | null = null;
  let expectCompany = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    const range = DATE_RANGE.exec(line);
    if (range && !BULLET.test(line)) {
      const head = line.slice(0, range.index).replace(/[|,–—-]\s*$/, "").trim();
      const end = range[2];
      cur = {
        id: uid("e_"),
        title: head,
        company: "",
        start: range[1],
        end: /present|current|now|ongoing/i.test(end) ? "Present" : end,
        current: /present|current|now|ongoing/i.test(end),
        bullets: [],
      };
      // "Title, Company" or "Title at Company" on one line
      const at = /^(.*?)\s+(?:at|@)\s+(.*)$/i.exec(head);
      if (at) {
        cur.title = at[1].trim();
        cur.company = at[2].trim();
      }
      if (/\bintern(ship)?\b/i.test(cur.title)) cur.employment_type = "internship";
      items.push(cur);
      expectCompany = !cur.company;
      continue;
    }
    if (!cur) continue;
    if (expectCompany && !BULLET.test(line)) {
      const [company, loc] = line.split(/\s+[|—–]\s+|\s{2,}/);
      cur.company = company.trim();
      if (loc) cur.location = loc.trim();
      expectCompany = false;
      continue;
    }
    if (BULLET.test(line)) cur.bullets.push({ id: uid("b_"), text: stripBullet(line) });
    else if (cur.bullets.length) cur.bullets[cur.bullets.length - 1].text += " " + line.trim();
  }
  return items;
}

function parseProjects(lines: string[]): ProjectItem[] {
  const items: ProjectItem[] = [];
  let cur: ProjectItem | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (BULLET.test(line)) {
      const t = stripBullet(line);
      const m = /^([^:]{3,90}):\s+(.*)$/.exec(t);
      if (m) {
        let name = m[1].trim();
        let technologies: string[] | undefined;
        const paren = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name);
        if (paren) {
          name = paren[1].trim();
          technologies = paren[2].split(/,\s*/).map((s) => s.trim());
        }
        cur = { id: uid("p_"), name, technologies, description: "", bullets: [{ id: uid("b_"), text: m[2].trim() }] };
        items.push(cur);
      } else if (cur) {
        cur.bullets.push({ id: uid("b_"), text: t });
      } else {
        cur = { id: uid("p_"), name: t.slice(0, 60), bullets: [{ id: uid("b_"), text: t }] };
        items.push(cur);
      }
    } else if (cur) {
      const last = cur.bullets[cur.bullets.length - 1];
      if (last) last.text += " " + line.trim();
    } else {
      cur = { id: uid("p_"), name: line.trim(), bullets: [] };
      items.push(cur);
    }
  }
  return items;
}

function parseEducation(lines: string[]): EducationItem[] {
  const items: EducationItem[] = [];
  let cur: EducationItem | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const range = DATE_RANGE.exec(line);
    const gradeM = /(CGPA|GPA|Percentage|Grade)\s*[:\-]?\s*([\d.]+%?(?:\s*\/\s*[\d.]+)?)/i.exec(line);
    const isDegree = /\b(bachelor|master|b\.?\s?tech|m\.?\s?tech|b\.?e\.?|b\.?sc|m\.?sc|mba|bca|mca|phd|diploma|class (x|xii|10|12)|high school|secondary)\b/i.test(line);
    if (isDegree) {
      const head = (range ? line.slice(0, range.index) : line).trim();
      const [degree, field] = head.split(/\s+[–—-]\s+|,\s*|\s+in\s+/);
      cur = {
        id: uid("ed_"),
        degree: degree.trim(),
        field: field?.trim(),
        institution: "",
        start: range?.[1],
        end: range?.[2],
      };
      if (gradeM) cur.grade = `${gradeM[1]}: ${gradeM[2]}`;
      items.push(cur);
      continue;
    }
    if (cur && !cur.institution) {
      const inst = gradeM ? line.slice(0, gradeM.index).trim() : line.trim();
      cur.institution = inst.replace(/[|,–—-]\s*$/, "").trim();
      if (gradeM) cur.grade = `${gradeM[1]}: ${gradeM[2]}`;
    } else if (cur && gradeM && !cur.grade) {
      cur.grade = `${gradeM[1]}: ${gradeM[2]}`;
    }
  }
  return items;
}

function parseSkills(lines: string[]): { category: string; items: string[] }[] {
  const groups: { category: string; items: string[] }[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const t = stripBullet(line).replace(/\.$/, "");
    const m = /^([^:]{2,40}):\s*(.*)$/.exec(t);
    const category = m ? m[1].trim() : "Skills";
    const items = (m ? m[2] : t)
      .split(/,|;|\s\|\s/)
      .map((s) => s.trim().replace(/\.$/, ""))
      .filter(Boolean);
    const existing = groups.find((g) => g.category === category);
    if (existing) existing.items.push(...items);
    else groups.push({ category, items });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Experience duration
// ---------------------------------------------------------------------------
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function parseMonth(s: string | undefined, now = new Date()): Date | null {
  if (!s) return null;
  if (/present|current|now/i.test(s)) return now;
  const m = /([a-z]{3})[a-z]*\.?\s+(\d{4})/i.exec(s);
  if (m) {
    const mi = MONTHS.indexOf(m[1].toLowerCase());
    if (mi >= 0) return new Date(Date.UTC(parseInt(m[2]), mi, 1));
  }
  const num = /(\d{1,2})\/(\d{4})/.exec(s);
  if (num) return new Date(Date.UTC(parseInt(num[2]), parseInt(num[1]) - 1, 1));
  const iso = /(\d{4})-(\d{2})/.exec(s);
  if (iso) return new Date(Date.UTC(parseInt(iso[1]), parseInt(iso[2]) - 1, 1));
  const y = /(\d{4})/.exec(s);
  if (y) return new Date(Date.UTC(parseInt(y[1]), 0, 1));
  return null;
}

/** Years of professional experience. Internships count at half weight. Overlaps are merged. */
export function experienceYears(items: ExperienceItem[], now = new Date()): number {
  const spans: { a: number; b: number; w: number }[] = [];
  for (const e of items) {
    const a = parseMonth(e.start, now);
    const b = parseMonth(e.end ?? (e.current ? "Present" : undefined), now) ?? a;
    if (!a || !b) continue;
    const w = e.employment_type === "internship" || /\bintern\b/i.test(e.title) ? 0.5 : 1;
    // inclusive month count: Dec 2025 – Jul 2026 = 8 months
    spans.push({ a: a.getTime(), b: b.getTime() + 31 * 864e5, w });
  }
  if (!spans.length) return 0;
  // weight by month buckets to avoid double counting overlaps
  const monthWeight = new Map<string, number>();
  for (const s of spans) {
    const d = new Date(s.a);
    while (d.getTime() < s.b - 15 * 864e5) {
      const k = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      monthWeight.set(k, Math.max(monthWeight.get(k) ?? 0, s.w));
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
  }
  let months = 0;
  for (const w of monthWeight.values()) months += w;
  return Math.round((months / 12) * 10) / 10;
}

export function emptyProfile(): CareerProfile {
  return {
    name: "", email: "", phone: "", location: "", links: [], summary: "", experience: [], projects: [],
    education: [], skills: [], certifications: [], achievements: [], languages: [], unknown_fields: [],
  };
}
