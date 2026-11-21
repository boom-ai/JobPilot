// Job source adapters. Only official/public APIs, RSS feeds and public ATS job-board APIs.
// Sites whose terms forbid automated access are "manual": the app builds a search link and the
// Chrome extension captures jobs while you browse them yourself.
import { XMLParser } from "fast-xml-parser";
import type { NormalizedJob } from "../types";
import type { AdapterContext, SearchQuery, SourceAdapter } from "./types";
import { SourceError } from "./types";
import {
  detectCountries,
  detectExperience,
  detectJobType,
  detectRemoteType,
  containsTerm,
  htmlToText,
  normalize,
  parseSalary,
} from "../text";
import { extractSkills } from "../skills";

const UA = "JobPilotAI/1.0 (personal job search assistant)";

async function getJson<T>(ctx: AdapterContext, source: string, url: string, init?: RequestInit): Promise<T> {
  const res = await ctx.fetch(url, { ...init, headers: { "user-agent": UA, accept: "application/json", ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new SourceError(source, `HTTP ${res.status}`, res.status);
  return (await res.json()) as T;
}

async function getText(ctx: AdapterContext, source: string, url: string): Promise<string> {
  const res = await ctx.fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new SourceError(source, `HTTP ${res.status}`, res.status);
  return res.text();
}

/** Keyword relevance gate used for sources that return everything (feeds, ATS boards). */
export function matchesQuery(job: Pick<NormalizedJob, "title" | "description" | "tags">, q: SearchQuery): boolean {
  const title = normalize(job.title);
  const text = normalize(`${job.title} ${(job.tags ?? []).join(" ")} ${(job.description ?? "").slice(0, 3000)}`);
  if (q.exclude.some((e) => e && containsTerm(text, e))) return false;
  const roleHit = q.roles.some((r) => {
    const words = normalize(r).split(" ").filter((w) => w.length > 2 && w !== "specialist" && w !== "associate");
    return words.length > 0 && words.filter((w) => containsTerm(title, w)).length >= Math.min(2, words.length);
  });
  // keywords: comma/OR separated groups; within a group every word must appear as a whole word
  const kws = q.keywords.split(/[,;]|\s+OR\s+/i).map((k) => normalize(k)).filter(Boolean);
  const kwHit = kws.some((k) => k.split(" ").some((w) => containsTerm(text, w)) && k.split(" ").filter((w) => w.length > 3).every((w) => containsTerm(text, w)));
  if (!q.roles.length && !kws.length) return true;
  return roleHit || kwHit;
}

/** Fill derived attributes from text. Adapters call this once per job. */
/** Drop repeats within one adapter's results (same external id). */
export function uniqueByExternalId(jobs: NormalizedJob[]): NormalizedJob[] {
  const seen = new Set<string>();
  return jobs.filter((j) => {
    const k = `${j.source}:${j.external_job_id ?? j.source_url ?? j.title + j.company}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function enrich(j: NormalizedJob): NormalizedJob {
  const desc = j.description ?? "";
  const exp = j.experience_min != null ? { min: j.experience_min, max: j.experience_max ?? null } : detectExperience(desc);
  let sal = { min: j.salary_min ?? null, max: j.salary_max ?? null, currency: j.currency ?? null, period: j.salary_period ?? null };
  if (sal.min == null && sal.max == null) {
    const p = parseSalary(j.salary_text ?? "");
    if (p.min != null) sal = p;
    else {
      const m = /(?:salary|compensation|pay|ctc)[^.\n]{0,80}/i.exec(desc);
      const p2 = parseSalary(m?.[0]);
      if (p2.min != null) sal = p2;
    }
  }
  const remote = j.remote_type && j.remote_type !== "unknown" ? j.remote_type : detectRemoteType(j.title, j.location, desc.slice(0, 1500));
  return {
    ...j,
    title: j.title.trim(),
    company: j.company.trim(),
    description: desc,
    remote_type: remote,
    job_type: j.job_type ?? detectJobType(j.title, desc.slice(0, 2000)),
    experience_min: exp.min,
    experience_max: exp.max,
    salary_min: sal.min,
    salary_max: sal.max,
    currency: sal.currency,
    salary_period: sal.period,
    countries: j.countries?.length ? j.countries : detectCountries(j.location),
    skills: j.skills?.length ? j.skills : extractSkills(`${j.title}\n${desc}`),
  };
}

const iso = (v: string | number | null | undefined): string | null => {
  if (v == null || v === "") return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

// ---------------------------------------------------------------------------
// Remote OK — public JSON API (attribution required: link back to the job URL)
// ---------------------------------------------------------------------------
export const remoteok: SourceAdapter = {
  id: "remoteok",
  name: "Remote OK",
  kind: "api",
  homepage: "https://remoteok.com",
  minIntervalMs: 60_000,
  notes: "Public JSON API (remoteok.com/api). Terms require linking back to Remote OK, which job cards do.",
  status: (s) => (s.sources.enabled.includes("remoteok") ? "available" : "disabled"),
  async search(q, ctx) {
    type R = { id?: string; slug?: string; position?: string; company?: string; company_logo?: string; logo?: string; location?: string; tags?: string[]; description?: string; date?: string; epoch?: number; url?: string; apply_url?: string; salary_min?: number; salary_max?: number };
    const tag = q.keywords.split(/\s+/)[0];
    const url = tag && /^(ai|llm|annotation|qa|data|analyst)$/i.test(tag) ? `https://remoteok.com/api?tag=${encodeURIComponent(tag.toLowerCase())}` : "https://remoteok.com/api";
    const data = await getJson<R[]>(ctx, "remoteok", url);
    return data
      .filter((r) => r.position && r.company)
      .map((r) =>
        enrich({
          title: r.position!,
          company: r.company!,
          company_logo: r.company_logo || r.logo || null,
          location: r.location || "Remote",
          remote_type: "remote",
          description: htmlToText(r.description),
          salary_min: r.salary_min || null,
          salary_max: r.salary_max || null,
          currency: r.salary_min ? "USD" : null,
          salary_period: r.salary_min ? "year" : null,
          source: "remoteok",
          source_url: r.url ?? null,
          apply_url: r.apply_url || r.url || null,
          external_job_id: String(r.id ?? r.slug),
          tags: r.tags ?? [],
          posted_at: iso(r.date ?? r.epoch),
        }),
      )
      .filter((j) => matchesQuery(j, q));
  },
};

// ---------------------------------------------------------------------------
// Remotive — public API
// ---------------------------------------------------------------------------
export const remotive: SourceAdapter = {
  id: "remotive",
  name: "Remotive",
  kind: "api",
  homepage: "https://remotive.com",
  minIntervalMs: 30_000,
  notes: "Public API (remotive.com/api/remote-jobs). Rate-limited; keep schedules ≥ 6h.",
  status: (s) => (s.sources.enabled.includes("remotive") ? "available" : "disabled"),
  async search(q, ctx) {
    type R = { id: number; url: string; title: string; company_name: string; company_logo?: string; category?: string; tags?: string[]; job_type?: string; publication_date?: string; candidate_required_location?: string; salary?: string; description?: string };
    const terms = [...new Set([q.keywords, ...q.roles.slice(0, 3)].filter(Boolean))].slice(0, 4);
    const all: NormalizedJob[] = [];
    for (const term of terms.length ? terms : [""]) {
      const data = await getJson<{ jobs: R[] }>(ctx, "remotive", `https://remotive.com/api/remote-jobs?limit=${q.limit ?? 100}${term ? `&search=${encodeURIComponent(term)}` : ""}`);
      for (const r of data.jobs ?? [])
        all.push(
          enrich({
            title: r.title,
            company: r.company_name,
            company_logo: r.company_logo ?? null,
            location: r.candidate_required_location || "Remote",
            remote_type: "remote",
            job_type: mapJobType(r.job_type),
            description: htmlToText(r.description),
            salary_text: r.salary || null,
            source: "remotive",
            source_url: r.url,
            apply_url: r.url,
            external_job_id: String(r.id),
            tags: [...(r.tags ?? []), ...(r.category ? [r.category] : [])],
            industry: r.category ?? null,
            posted_at: iso(r.publication_date),
          }),
        );
    }
    return uniqueByExternalId(all).filter((j) => matchesQuery(j, q));
  },
};

function mapJobType(t?: string | null): NormalizedJob["job_type"] {
  const n = normalize(t);
  if (!n) return null;
  if (n.includes("full")) return "full-time";
  if (n.includes("part")) return "part-time";
  if (n.includes("contract")) return "contract";
  if (n.includes("freelance")) return "freelance";
  if (n.includes("intern")) return "internship";
  if (n.includes("temp")) return "temporary";
  return null;
}

// ---------------------------------------------------------------------------
// We Work Remotely — public RSS
// ---------------------------------------------------------------------------
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", cdataPropName: false as never });

export const weworkremotely: SourceAdapter = {
  id: "weworkremotely",
  name: "We Work Remotely",
  kind: "rss",
  homepage: "https://weworkremotely.com",
  minIntervalMs: 60_000,
  notes: "Public RSS feeds (all jobs + category feeds).",
  status: (s) => (s.sources.enabled.includes("weworkremotely") ? "available" : "disabled"),
  async search(q, ctx) {
    const feeds = ["https://weworkremotely.com/remote-jobs.rss"];
    const out: NormalizedJob[] = [];
    for (const f of feeds) {
      const doc = xml.parse(await getText(ctx, "weworkremotely", f)) as { rss?: { channel?: { item?: unknown } } };
      const raw = doc.rss?.channel?.item;
      const items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as { title?: string; region?: string; category?: string; type?: string; link?: string; guid?: string | { "#text": string }; pubDate?: string; description?: string; "media:content"?: { "@_url"?: string } }[];
      for (const it of items) {
        const title = String(it.title ?? "");
        const idx = title.indexOf(":");
        const company = idx > 0 ? title.slice(0, idx).trim() : "Unknown";
        const position = idx > 0 ? title.slice(idx + 1).trim() : title;
        const guid = typeof it.guid === "object" ? it.guid["#text"] : it.guid;
        out.push(
          enrich({
            title: position,
            company,
            company_logo: it["media:content"]?.["@_url"] ?? null,
            location: it.region || "Remote",
            remote_type: "remote",
            job_type: mapJobType(it.type),
            description: htmlToText(it.description),
            source: "weworkremotely",
            source_url: it.link ?? guid ?? null,
            apply_url: it.link ?? null,
            external_job_id: guid ?? it.link ?? null,
            tags: it.category ? [it.category] : [],
            posted_at: iso(it.pubDate),
          }),
        );
      }
    }
    return out.filter((j) => matchesQuery(j, q));
  },
};

// ---------------------------------------------------------------------------
// Himalayas — public jobs API
// ---------------------------------------------------------------------------
export const himalayas: SourceAdapter = {
  id: "himalayas",
  name: "Himalayas",
  kind: "api",
  homepage: "https://himalayas.app",
  minIntervalMs: 30_000,
  notes: "Public remote-jobs API (himalayas.app/jobs/api). Max 20 results per page.",
  status: (s) => (s.sources.enabled.includes("himalayas") ? "available" : "disabled"),
  async search(q, ctx) {
    type R = { title: string; excerpt?: string; companyName: string; companyLogo?: string; employmentType?: string; minSalary?: number | null; maxSalary?: number | null; currency?: string; locationRestrictions?: string[]; categories?: string[]; description?: string; pubDate?: number | string; expiryDate?: number | string; applicationLink?: string; guid?: string; seniority?: string[] };
    const terms = [q.keywords, ...q.roles.slice(0, 2)].filter(Boolean).slice(0, 3);
    const out: NormalizedJob[] = [];
    for (const term of terms.length ? terms : [""]) {
      const url = term ? `https://himalayas.app/jobs/api/search?q=${encodeURIComponent(term)}&limit=20` : "https://himalayas.app/jobs/api?limit=20";
      const data = await getJson<{ jobs?: R[] }>(ctx, "himalayas", url);
      for (const r of data.jobs ?? []) {
        const restr = r.locationRestrictions ?? [];
        out.push(
          enrich({
            title: r.title,
            company: r.companyName,
            company_logo: r.companyLogo ?? null,
            location: restr.length ? `Remote (${restr.join(", ")})` : "Remote (Worldwide)",
            countries: restr.length ? restr : ["Worldwide"],
            remote_type: "remote",
            job_type: mapJobType(r.employmentType),
            description: htmlToText(r.description ?? r.excerpt),
            salary_min: r.minSalary ?? null,
            salary_max: r.maxSalary ?? null,
            currency: r.minSalary ? r.currency ?? "USD" : null,
            salary_period: r.minSalary ? "year" : null,
            source: "himalayas",
            source_url: r.guid ?? r.applicationLink ?? null,
            apply_url: r.applicationLink ?? r.guid ?? null,
            external_job_id: r.guid ?? `${r.companyName}-${r.title}`,
            tags: [...(r.categories ?? []), ...(r.seniority ?? [])],
            posted_at: iso(r.pubDate),
            deadline: iso(r.expiryDate)?.slice(0, 10) ?? null,
          }),
        );
      }
    }
    return uniqueByExternalId(out).filter((j) => matchesQuery(j, q));
  },
};

// ---------------------------------------------------------------------------
// Arbeitnow — public job board API (EU-heavy, some remote)
// ---------------------------------------------------------------------------
export const arbeitnow: SourceAdapter = {
  id: "arbeitnow",
  name: "Arbeitnow",
  kind: "api",
  homepage: "https://www.arbeitnow.com",
  minIntervalMs: 30_000,
  notes: "Public API (arbeitnow.com/api/job-board-api). Mostly Europe; remote roles flagged.",
  status: (s) => (s.sources.enabled.includes("arbeitnow") ? "available" : "disabled"),
  async search(q, ctx) {
    type R = { slug: string; company_name: string; title: string; description: string; remote: boolean; url: string; tags?: string[]; job_types?: string[]; location?: string; created_at?: number };
    const out: NormalizedJob[] = [];
    for (let page = 1; page <= 2; page++) {
      const data = await getJson<{ data: R[] }>(ctx, "arbeitnow", `https://www.arbeitnow.com/api/job-board-api?page=${page}`);
      for (const r of data.data ?? [])
        out.push(
          enrich({
            title: r.title,
            company: r.company_name,
            location: r.location ?? null,
            remote_type: r.remote ? "remote" : "unknown",
            job_type: mapJobType(r.job_types?.[0]),
            description: htmlToText(r.description),
            source: "arbeitnow",
            source_url: r.url,
            apply_url: r.url,
            external_job_id: r.slug,
            tags: r.tags ?? [],
            posted_at: iso(r.created_at),
          }),
        );
    }
    return out.filter((j) => matchesQuery(j, q));
  },
};

// ---------------------------------------------------------------------------
// Greenhouse — public Job Board API, per company board token
// ---------------------------------------------------------------------------
export const greenhouse: SourceAdapter = {
  id: "greenhouse",
  name: "Greenhouse boards",
  kind: "ats",
  homepage: "https://boards.greenhouse.io",
  minIntervalMs: 2_000,
  notes: "Public Job Board API per company (boards-api.greenhouse.io). Add board tokens in Settings → Sources.",
  status: (s) => (!s.sources.enabled.includes("greenhouse") ? "disabled" : s.sources.greenhouse_boards.length ? "available" : "needs_config"),
  async search(q, ctx) {
    const out: NormalizedJob[] = [];
    for (const board of ctx.settings.sources.greenhouse_boards) {
      try {
        type R = { id: number; title: string; updated_at?: string; first_published?: string; location?: { name?: string }; absolute_url: string; content?: string; departments?: { name: string }[]; company_name?: string };
        const data = await getJson<{ jobs: R[] }>(ctx, "greenhouse", `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`);
        const meta = await getJson<{ name?: string }>(ctx, "greenhouse", `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}`).catch(() => ({ name: undefined }));
        for (const r of data.jobs ?? [])
          out.push(
            enrich({
              title: r.title,
              company: r.company_name || meta.name || board,
              location: r.location?.name ?? null,
              description: htmlToText(r.content),
              source: "greenhouse",
              source_url: r.absolute_url,
              apply_url: r.absolute_url,
              external_job_id: `${board}:${r.id}`,
              tags: (r.departments ?? []).map((d) => d.name),
              posted_at: iso(r.first_published ?? r.updated_at),
            }),
          );
      } catch (e) {
        ctx.log(`greenhouse board "${board}" failed: ${(e as Error).message}`);
      }
    }
    return out.filter((j) => matchesQuery(j, q));
  },
};

// ---------------------------------------------------------------------------
// Lever — public postings API, per company
// ---------------------------------------------------------------------------
export const lever: SourceAdapter = {
  id: "lever",
  name: "Lever postings",
  kind: "ats",
  homepage: "https://jobs.lever.co",
  minIntervalMs: 2_000,
  notes: "Public Postings API per company (api.lever.co/v0/postings/<company>). Add company slugs in Settings → Sources.",
  status: (s) => (!s.sources.enabled.includes("lever") ? "disabled" : s.sources.lever_companies.length ? "available" : "needs_config"),
  async search(q, ctx) {
    const out: NormalizedJob[] = [];
    for (const company of ctx.settings.sources.lever_companies) {
      try {
        type R = { id: string; text: string; hostedUrl: string; applyUrl?: string; createdAt?: number; descriptionPlain?: string; description?: string; additionalPlain?: string; lists?: { text: string; content: string }[]; categories?: { location?: string; commitment?: string; team?: string; allLocations?: string[] }; workplaceType?: string; salaryRange?: { min?: number; max?: number; currency?: string; interval?: string } };
        const data = await getJson<R[]>(ctx, "lever", `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`);
        for (const r of data) {
          const lists = (r.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join("\n\n");
          out.push(
            enrich({
              title: r.text,
              company: company.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
              location: r.categories?.location ?? null,
              remote_type: r.workplaceType === "remote" ? "remote" : r.workplaceType === "hybrid" ? "hybrid" : r.workplaceType === "onsite" ? "onsite" : "unknown",
              job_type: mapJobType(r.categories?.commitment),
              description: [r.descriptionPlain ?? htmlToText(r.description), lists, r.additionalPlain].filter(Boolean).join("\n\n"),
              salary_min: r.salaryRange?.min ?? null,
              salary_max: r.salaryRange?.max ?? null,
              currency: r.salaryRange?.currency ?? null,
              salary_period: r.salaryRange?.interval?.includes("hour") ? "hour" : r.salaryRange?.interval?.includes("month") ? "month" : r.salaryRange ? "year" : null,
              source: "lever",
              source_url: r.hostedUrl,
              apply_url: r.applyUrl ?? `${r.hostedUrl}/apply`,
              external_job_id: `${company}:${r.id}`,
              tags: [r.categories?.team].filter(Boolean) as string[],
              posted_at: iso(r.createdAt),
            }),
          );
        }
      } catch (e) {
        ctx.log(`lever company "${company}" failed: ${(e as Error).message}`);
      }
    }
    return out.filter((j) => matchesQuery(j, q));
  },
};

// ---------------------------------------------------------------------------
// Ashby — public posting API, per job board
// ---------------------------------------------------------------------------
export const ashby: SourceAdapter = {
  id: "ashby",
  name: "Ashby boards",
  kind: "ats",
  homepage: "https://jobs.ashbyhq.com",
  minIntervalMs: 2_000,
  notes: "Public Posting API per board (api.ashbyhq.com/posting-api/job-board/<name>). Add board names in Settings → Sources.",
  status: (s) => (!s.sources.enabled.includes("ashby") ? "disabled" : s.sources.ashby_boards.length ? "available" : "needs_config"),
  async search(q, ctx) {
    const out: NormalizedJob[] = [];
    for (const board of ctx.settings.sources.ashby_boards) {
      try {
        type R = { id: string; title: string; location?: string; department?: string; team?: string; employmentType?: string; isRemote?: boolean; workplaceType?: string; descriptionPlain?: string; descriptionHtml?: string; publishedAt?: string; jobUrl: string; applyUrl?: string; compensation?: { compensationTierSummary?: string; summaryComponents?: { compensationType?: string; interval?: string; currencyCode?: string; minValue?: number; maxValue?: number }[] } };
        const data = await getJson<{ jobs: R[] }>(ctx, "ashby", `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`);
        for (const r of data.jobs ?? []) {
          const sal = r.compensation?.summaryComponents?.find((c) => c.compensationType === "Salary");
          out.push(
            enrich({
              title: r.title,
              company: board.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
              location: r.location ?? null,
              remote_type: r.isRemote || r.workplaceType === "Remote" ? "remote" : r.workplaceType === "Hybrid" ? "hybrid" : r.workplaceType === "OnSite" ? "onsite" : "unknown",
              job_type: mapJobType(r.employmentType),
              description: r.descriptionPlain ?? htmlToText(r.descriptionHtml),
              salary_min: sal?.minValue ?? null,
              salary_max: sal?.maxValue ?? null,
              currency: sal?.currencyCode ?? null,
              salary_period: sal ? (sal.interval?.includes("HOUR") ? "hour" : sal.interval?.includes("MONTH") ? "month" : "year") : null,
              salary_text: r.compensation?.compensationTierSummary ?? null,
              source: "ashby",
              source_url: r.jobUrl,
              apply_url: r.applyUrl ?? r.jobUrl,
              external_job_id: `${board}:${r.id}`,
              tags: [r.department, r.team].filter(Boolean) as string[],
              posted_at: iso(r.publishedAt),
            }),
          );
        }
      } catch (e) {
        ctx.log(`ashby board "${board}" failed: ${(e as Error).message}`);
      }
    }
    return out.filter((j) => matchesQuery(j, q));
  },
};

// ---------------------------------------------------------------------------
// Workday — public CXS endpoint used by career sites (configure full site URLs)
// ---------------------------------------------------------------------------
export function parseWorkdaySite(url: string): { origin: string; tenant: string; site: string } | null {
  const m = /^https:\/\/([^.]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)/.exec(url.trim());
  if (!m) return null;
  return { origin: `https://${m[1]}.${m[2]}.myworkdayjobs.com`, tenant: m[1], site: m[3] };
}

export const workday: SourceAdapter = {
  id: "workday",
  name: "Workday career sites",
  kind: "ats",
  homepage: "https://www.myworkday.com",
  minIntervalMs: 3_000,
  notes: "Uses the public JSON endpoint behind Workday career sites. Add site URLs like https://company.wd5.myworkdayjobs.com/en-US/External. Untested against every tenant.",
  status: (s) => (!s.sources.enabled.includes("workday") ? "disabled" : s.sources.workday_sites.length ? "available" : "needs_config"),
  async search(q, ctx) {
    const out: NormalizedJob[] = [];
    const term = [q.keywords, q.roles[0]].filter(Boolean).join(" ").slice(0, 80);
    for (const siteUrl of ctx.settings.sources.workday_sites) {
      const site = parseWorkdaySite(siteUrl);
      if (!site) {
        ctx.log(`workday: could not parse site URL ${siteUrl}`);
        continue;
      }
      try {
        type R = { title: string; externalPath: string; locationsText?: string; postedOn?: string; bulletFields?: string[] };
        const data = await getJson<{ jobPostings?: R[] }>(ctx, "workday", `${site.origin}/wday/cxs/${site.tenant}/${site.site}/jobs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: term }),
        });
        for (const r of data.jobPostings ?? []) {
          const url = `${site.origin}/${site.site}${r.externalPath}`;
          out.push(
            enrich({
              title: r.title,
              company: site.tenant,
              location: r.locationsText ?? null,
              description: "",
              source: "workday",
              source_url: url,
              apply_url: url,
              external_job_id: `${site.tenant}:${r.bulletFields?.[0] ?? r.externalPath}`,
              posted_at: null,
            }),
          );
        }
      } catch (e) {
        ctx.log(`workday ${siteUrl} failed: ${(e as Error).message}`);
      }
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// Manual / browser-assisted sources (no automated scraping)
// ---------------------------------------------------------------------------
function manual(id: string, name: string, homepage: string, build: (q: SearchQuery) => string, notes: string): SourceAdapter {
  return {
    id,
    name,
    kind: "manual",
    homepage,
    minIntervalMs: 0,
    notes,
    status: () => "manual",
    searchUrl: build,
  };
}
const enc = encodeURIComponent;
const kw = (q: SearchQuery) => (q.keywords || q.roles[0] || "").trim();
const loc = (q: SearchQuery) => q.locations.find((l) => !/remote/i.test(l)) ?? "";

export const manualSources: SourceAdapter[] = [
  manual("linkedin", "LinkedIn Jobs", "https://www.linkedin.com/jobs", (q) => `https://www.linkedin.com/jobs/search/?keywords=${enc(kw(q))}${loc(q) ? `&location=${enc(loc(q))}` : ""}${q.locations.some((l) => /remote/i.test(l)) ? "&f_WT=2" : ""}&f_TPR=r604800`, "Automated access is prohibited by LinkedIn's terms. Open the search, then use the extension's Save Job on any listing."),
  manual("naukri", "Naukri", "https://www.naukri.com", (q) => `https://www.naukri.com/${enc(kw(q).toLowerCase().replace(/\s+/g, "-"))}-jobs${loc(q) ? `-in-${enc(loc(q).toLowerCase())}` : ""}?jobAge=7`, "No public API; scraping is prohibited. Browse normally and capture with the extension."),
  manual("indeed", "Indeed", "https://in.indeed.com", (q) => `https://in.indeed.com/jobs?q=${enc(kw(q))}&l=${enc(loc(q) || (q.locations.some((l) => /remote/i.test(l)) ? "Remote" : ""))}&fromage=7`, "Indeed's job search API is partner-only. Open the search and capture listings with the extension."),
  manual("foundit", "Foundit", "https://www.foundit.in", (q) => `https://www.foundit.in/srp/results?query=${enc(kw(q))}${loc(q) ? `&locations=${enc(loc(q))}` : ""}`, "No public API. Browser-assisted only."),
  manual("glassdoor", "Glassdoor", "https://www.glassdoor.co.in", (q) => `https://www.glassdoor.co.in/Job/jobs.htm?sc.keyword=${enc(kw(q))}`, "No public job API. Browser-assisted only."),
  manual("wellfound", "Wellfound", "https://wellfound.com", (q) => `https://wellfound.com/role/r/${enc(kw(q).toLowerCase().replace(/\s+/g, "-"))}`, "Login required. Browser-assisted only."),
  manual("instahyre", "Instahyre", "https://www.instahyre.com", () => `https://www.instahyre.com/search-jobs/`, "Login required. Browser-assisted only."),
  manual("hirist", "Hirist", "https://www.hirist.tech", (q) => `https://www.hirist.tech/search/${enc(kw(q).toLowerCase().replace(/\s+/g, "-"))}`, "No public API. Browser-assisted only."),
  manual("cutshort", "Cutshort", "https://cutshort.io", () => `https://cutshort.io/jobs`, "Login required. Browser-assisted only."),
  manual("flexjobs", "FlexJobs", "https://www.flexjobs.com", (q) => `https://www.flexjobs.com/search?searchkeyword=${enc(kw(q))}`, "Paid membership; no public API. Browser-assisted only."),
];

export const automatedSources: SourceAdapter[] = [remoteok, remotive, weworkremotely, himalayas, arbeitnow, greenhouse, lever, ashby, workday];
export const ALL_SOURCES: SourceAdapter[] = [...automatedSources, ...manualSources];
export const sourceById = (id: string) => ALL_SOURCES.find((s) => s.id === id);
