import { describe, expect, it } from "vitest";
import { scoreJob, titleSimilarity } from "@/lib/matching/score";
import { filterJobs, sortJobs } from "@/lib/matching/filters";
import { findDuplicate, fingerprint, canonicalUrl } from "@/lib/matching/dedupe";
import { DEFAULT_PREFERENCES } from "@/lib/defaults";
import { detectExperience, parseSalary, toAnnualINR, htmlToText } from "@/lib/text";
import { llmEvalJob, sampleProfile, seniorEngJob } from "./helpers";

const ctx = { profile: sampleProfile(), preferences: DEFAULT_PREFERENCES, now: new Date("2026-11-22") };

describe("scoring", () => {
  it("rates a matching LLM evaluator job highly with reasons", () => {
    const m = scoreJob(llmEvalJob, ctx);
    expect(m.overall).toBeGreaterThanOrEqual(80);
    expect(["Excellent", "Strong"]).toContain(m.recommendation);
    expect(m.matched_skills).toEqual(expect.arrayContaining(["LLM Evaluation", "RLHF", "Data Annotation"]));
    expect(m.why_match.length).toBeGreaterThan(0);
  });
  it("rates a senior on-site engineering job low with risks", () => {
    const m = scoreJob(seniorEngJob, ctx);
    expect(m.overall).toBeLessThan(50);
    expect(m.recommendation).toBe("Low");
    expect(m.risks.join(" ")).toMatch(/Experience mismatch/);
    expect(m.risks.join(" ")).toMatch(/outside India/);
  });
  it("flags salary below the user's minimum", () => {
    const m = scoreJob({ ...llmEvalJob, salary_min: 300000, salary_max: 400000, currency: "INR", salary_period: "year" }, { ...ctx, preferences: { ...DEFAULT_PREFERENCES, min_salary_inr_lpa: 7 } });
    expect(m.risks.join(" ")).toMatch(/Salary mismatch/);
    expect(m.breakdown.salary).toBeLessThan(70);
  });
  it("matches role families", () => {
    expect(titleSimilarity("AI Response Rater", ["LLM Evaluator"]).score).toBeGreaterThan(40);
    expect(titleSimilarity("Sales Manager", ["LLM Evaluator"]).score).toBeLessThan(20);
  });
});

describe("text detection", () => {
  it("parses experience requirements", () => {
    expect(detectExperience("Requires 3+ years of experience")).toEqual({ min: 3, max: null });
    expect(detectExperience("2-4 years experience")).toEqual({ min: 2, max: 4 });
    expect(detectExperience("Freshers welcome")).toEqual({ min: 0, max: 1 });
  });
  it("parses salaries", () => {
    expect(parseSalary("₹5-8 LPA")).toEqual({ min: 500000, max: 800000, currency: "INR", period: "year" });
    expect(parseSalary("$20 - $25 per hour")).toMatchObject({ min: 20, max: 25, currency: "USD", period: "hour" });
    expect(parseSalary("$90k – $120k")).toMatchObject({ min: 90000, max: 120000, currency: "USD" });
    expect(toAnnualINR(20, "USD", "hour", 85)).toBe(3400000);
  });
  it("converts escaped HTML", () => {
    expect(htmlToText("&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;/ul&gt;")).toBe("Hello & welcome\n\n• One");
  });
});

describe("filters", () => {
  const jobs = [
    { ...llmEvalJob, id: "a", match_score: 88 },
    { ...seniorEngJob, id: "b", match_score: 20 },
    { ...llmEvalJob, id: "c", title: "Data Annotator", company: "Other", salary_min: 600000, salary_max: 900000, currency: "INR", salary_period: "year" as const, match_score: 75, location: "Bengaluru, India", remote_type: "hybrid" as const },
  ];
  it("remote filter", () => expect(filterJobs(jobs, { remote_types: ["remote"] }).kept.map((j) => j.id)).toEqual(["a"]));
  it("non-coding + AI filter", () => expect(filterJobs(jobs, { non_coding: true, ai_related: true }).kept.map((j) => j.id)).toEqual(["a", "c"]));
  it("salary filter with undisclosed excluded", () => expect(filterJobs(jobs, { salary_min_lpa: 5, include_undisclosed_salary: false }).kept.map((j) => j.id)).toEqual(["c"]));
  it("experience range excludes 7+ yrs", () => expect(filterJobs(jobs, { experience: { min: 0, max: 2 } }).kept.map((j) => j.id)).not.toContain("b"));
  it("India country filter", () => expect(filterJobs(jobs, { countries: ["India"] }).kept.map((j) => j.id)).toEqual(["a", "c"]));
  it("min score + exclusions", () => {
    expect(filterJobs(jobs, { min_score: 80 }).kept.map((j) => j.id)).toEqual(["a"]);
    expect(filterJobs(jobs, { exclude_companies: ["acme ai"] }).kept.map((j) => j.id)).toEqual(["b", "c"]);
  });
  it("sorts by score and salary", () => {
    expect(sortJobs(jobs, "score").map((j) => j.id)).toEqual(["a", "c", "b"]);
    expect(sortJobs(jobs, "salary")[0].id).toBe("c");
  });
});

describe("dedupe", () => {
  it("matches by canonical URL ignoring tracking params", () => {
    expect(canonicalUrl("https://www.jobs.example.com/acme/llm-evaluator/?utm_source=li#apply")).toBe("jobs.example.com/acme/llm-evaluator");
    const d = findDuplicate({ ...llmEvalJob, source: "other" }, [{ id: "x", ...llmEvalJob, source_url: "https://jobs.example.com/acme/llm-evaluator" }]);
    expect(d?.reason).toBe("url");
  });
  it("matches cross-posted jobs by fingerprint", () => {
    const repost = { ...llmEvalJob, title: "LLM Evaluator - Remote", company: "Acme AI Inc.", source: "remotive", source_url: "https://remotive.com/x" };
    expect(fingerprint(repost)).toBe(fingerprint(llmEvalJob));
    expect(findDuplicate(repost, [{ id: "x", ...llmEvalJob }])?.id).toBe("x");
  });
  it("matches by description similarity", () => {
    const re = { ...llmEvalJob, title: "Evaluator, LLM", location: "Anywhere", remote_type: "unknown" as const, source_url: "https://b.com" };
    expect(findDuplicate(re, [{ id: "x", ...llmEvalJob, source_url: "https://a.com" }])?.reason).toBe("description");
  });
  it("does not merge different jobs", () => {
    expect(findDuplicate(seniorEngJob, [{ id: "x", ...llmEvalJob }])).toBeNull();
  });
});
