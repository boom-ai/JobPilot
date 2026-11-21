import { describe, expect, it } from "vitest";
import { runSources } from "@/lib/sources/run";
import { manualSources, parseWorkdaySite } from "@/lib/sources/adapters";
import { mergeSettings } from "@/lib/defaults";
import { fixture } from "./helpers";

const q = { keywords: "AI", roles: ["LLM Evaluator", "AI Trainer", "Data Annotation Specialist", "Model Quality Analyst", "Prompt Evaluator", "AI Quality Analyst"], locations: ["India", "Remote"], exclude: [] };

function fakeFetch(failing: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const host = new URL(url).host;
    if (failing.some((f) => host.includes(f))) return new Response("boom", { status: 503 });
    if (host.includes("remoteok")) return new Response(fixture("sources/remoteok.json"));
    if (host.includes("remotive")) return new Response(fixture("sources/remotive.json"));
    if (host.includes("weworkremotely")) return new Response(fixture("sources/wwr.rss"));
    if (host.includes("greenhouse")) return url.endsWith("/jobs?content=true") ? new Response(fixture("sources/greenhouse_jobs.json")) : new Response(JSON.stringify({ name: "Scale AI" }));
    if (host.includes("lever")) return new Response(fixture("sources/lever.json"));
    if (host.includes("ashby")) return new Response(fixture("sources/ashby.json"));
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

const settings = mergeSettings({ sources: { enabled: ["remoteok", "remotive", "weworkremotely", "greenhouse", "lever", "ashby"], greenhouse_boards: ["scaleai"], lever_companies: ["acmeai"], ashby_boards: ["acme"], workday_sites: [] } });

describe("source adapters (fixtures of documented API shapes)", () => {
  it("normalizes jobs from every source and filters irrelevant ones", async () => {
    const { jobs, results } = await runSources(q, settings, { fetchImpl: fakeFetch(), respectRateLimit: false });
    expect(results.every((r) => r.ok)).toBe(true);
    const titles = jobs.map((j) => j.title).sort();
    expect(titles).toEqual(["AI Data Annotation Specialist", "AI Data Quality Analyst", "AI Trainer (Hindi)", "LLM Response Evaluator", "Model Quality Analyst", "Prompt Evaluator"]);
    const lever = jobs.find((j) => j.source === "lever")!;
    expect(lever).toMatchObject({ remote_type: "hybrid", job_type: "full-time", salary_min: 600000, currency: "INR", experience_min: 1, experience_max: 3 });
    const remotive = jobs.find((j) => j.source === "remotive")!;
    expect(remotive).toMatchObject({ salary_min: 12, salary_max: 18, currency: "USD", salary_period: "hour", job_type: "contract" });
    const gh = jobs.find((j) => j.source === "greenhouse")!;
    expect(gh.description).toContain("• Image annotation");
    expect(gh.company).toBe("Scale AI");
    expect(gh.countries).toContain("India");
    const wwr = jobs.find((j) => j.source === "weworkremotely")!;
    expect(wwr.company).toBe("Invisible Technologies");
    const rok = jobs.find((j) => j.source === "remoteok")!;
    expect(rok.experience_min).toBe(0);
  });
  it("isolates failing sources", async () => {
    const { jobs, results } = await runSources(q, settings, { fetchImpl: fakeFetch(["remotive", "lever"]), respectRateLimit: false });
    expect(results.find((r) => r.source === "remotive")?.ok).toBe(false);
    expect(results.find((r) => r.source === "remotive")?.error).toMatch(/503/);
    expect(results.find((r) => r.source === "lever")?.logs[0]).toMatch(/acmeai/);
    expect(jobs.length).toBeGreaterThanOrEqual(4);
  });
  it("reports unconfigured ATS sources instead of pretending", async () => {
    const s = mergeSettings({ sources: { enabled: ["greenhouse"], greenhouse_boards: [], lever_companies: [], ashby_boards: [], workday_sites: [] } });
    const { results } = await runSources(q, s, { fetchImpl: fakeFetch(), respectRateLimit: false });
    expect(results[0]).toMatchObject({ ok: false, skipped: "needs configuration" });
  });
  it("builds manual search links", () => {
    const li = manualSources.find((m) => m.id === "linkedin")!;
    expect(li.status(settings)).toBe("manual");
    expect(li.searchUrl!({ ...q, keywords: "LLM Evaluator" })).toContain("keywords=LLM%20Evaluator");
    expect(parseWorkdaySite("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite")).toEqual({ origin: "https://nvidia.wd5.myworkdayjobs.com", tenant: "nvidia", site: "NVIDIAExternalCareerSite" });
  });
});
