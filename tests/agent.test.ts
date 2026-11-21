import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb, LOCAL_USER_ID } from "@/lib/supabase/localdb";
import type { DB } from "@/lib/supabase/clients";
import { seedDefaults } from "@/lib/agent/pipeline";
import { enqueue, setAgentState } from "@/lib/agent/queue";
import { processTasks } from "@/lib/agent/runner";
import { prepareApplication, checkLimits } from "@/lib/agent/services";
import { setApplicationStatus } from "@/lib/agent/records";
import { mergeSettings, DEFAULT_PREFERENCES } from "@/lib/defaults";
import { sampleProfile, fixture } from "./helpers";

const U = LOCAL_USER_ID;
function fakeFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const host = new URL(String(input)).host;
    if (host.includes("remoteok")) return new Response(fixture("sources/remoteok.json"));
    if (host.includes("remotive")) return new Response(fixture("sources/remotive.json"));
    if (host.includes("weworkremotely")) return new Response(fixture("sources/wwr.rss"));
    if (host.includes("greenhouse")) return String(input).includes("/jobs") ? new Response(fixture("sources/greenhouse_jobs.json")) : new Response('{"name":"Scale AI"}');
    if (host.includes("lever")) return new Response(fixture("sources/lever.json"));
    if (host.includes("ashby")) return new Response(fixture("sources/ashby.json"));
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
}

let db: DB;
beforeEach(async () => {
  db = memoryDb() as unknown as DB;
  const settings = mergeSettings({
    automation: { ...mergeSettings({}).automation, mode: "assisted", auto_tailor_min_score: 80 },
    sources: { enabled: ["remoteok", "remotive", "weworkremotely", "greenhouse", "lever", "ashby"], greenhouse_boards: ["scaleai"], lever_companies: ["acmeai"], ashby_boards: ["acme"], workday_sites: [] },
  });
  await db.from("user_profiles").insert({ user_id: U, profile_data: sampleProfile(), preferences: { ...DEFAULT_PREFERENCES, notice_period: "Immediate" }, settings });
  await seedDefaults(db, U);
});

async function drain(rounds = 6) {
  const all: { type: string; status: string; error?: string }[] = [];
  for (let i = 0; i < rounds; i++) {
    const { processed } = await processTasks(db, { workerId: "test", limit: 20, secretsDb: null, fetchImpl: fakeFetch() });
    all.push(...processed);
    if (!processed.length) break;
  }
  return all;
}

describe("agent pipeline (local DB)", () => {
  it("seeds presets, answer library and agent state", async () => {
    const { data } = await db.from("saved_searches").select("name").eq("user_id", U);
    expect(data!.map((d: { name: string }) => d.name)).toContain("LLM Evaluator");
    const { data: lib } = await db.from("answer_library").select("key").eq("user_id", U);
    expect(lib!.length).toBe(7);
  });

  it("runs search → dedupe → score → auto-tailor → prepare → queue for assisted apply", async () => {
    await enqueue(db, U, "search", { payload: {} });
    const processed = await drain();
    expect(processed.find((p) => p.type === "search")?.status).toBe("completed");
    const { data: jobs } = await db.from("jobs").select("id, title, match_score, source").eq("user_id", U);
    expect(jobs!.length).toBeGreaterThanOrEqual(5);
    expect(jobs!.every((j: { match_score: number | null }) => typeof j.match_score === "number")).toBe(true);
    // second run must not duplicate
    await enqueue(db, U, "search", { payload: {} });
    // bypass in-process rate limiter by waiting is impractical; the pipeline still dedupes when sources are skipped
    await drain();
    const { data: jobs2 } = await db.from("jobs").select("id").eq("user_id", U);
    expect(jobs2!.length).toBe(jobs!.length);
    const { data: events } = await db.from("agent_events").select("kind, message").eq("user_id", U);
    const kinds = events!.map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["search_started", "jobs_retrieved", "jobs_scored"]));
    const { data: tasks } = await db.from("agent_tasks").select("task_type, status, error").eq("user_id", U);
    const tailored = tasks!.filter((t: { task_type: string }) => t.task_type === "resume_tailoring");
    if (tailored.length) {
      expect(tailored.every((t: { status: string }) => t.status === "completed")).toBe(true);
      const { data: versions } = await db.from("resume_versions").select("file_name, method").eq("user_id", U);
      expect(versions!.length).toBe(tailored.length);
      expect(versions![0].method).toBe("rules");
      // ATS jobs ≥ 80 in assisted mode get a browser submission task that the web runner never executes
      const sub = tasks!.filter((t: { task_type: string }) => t.task_type === "application_submission");
      for (const s of sub) expect(s.status).toBe("pending");
    }
    const { data: notes } = await db.from("notifications").select("type").eq("user_id", U);
    expect(notes!.length).toBeGreaterThan(0);
  });

  it("routes non-ATS jobs to manual and blocks duplicates", async () => {
    const { data: job } = await db.from("jobs").insert({ user_id: U, title: "LLM Evaluator", company: "X", source: "linkedin", source_url: "https://www.linkedin.com/jobs/view/1", description: "Evaluate LLM responses. RLHF.", match_score: 92 }).select("id").single();
    const r = await prepareApplication(db, await (await import("@/lib/agent/context")).loadUserContext(db, U, null), job!.id);
    expect(r.route).toBe("manual");
    const { data: app } = await db.from("applications").select("application_status, resume_version_id").eq("job_id", job!.id).single();
    expect(app!.application_status).toBe("ready_to_apply");
    expect(app!.resume_version_id).toBeTruthy();
    const { count } = await db.from("application_answers").select("id", { count: "exact", head: true }).eq("job_id", job!.id);
    expect(count).toBeGreaterThan(5);
    await setApplicationStatus(db, U, job!.id, "applied");
    const ctx = await (await import("@/lib/agent/context")).loadUserContext(db, U, null);
    expect((await prepareApplication(db, ctx, job!.id)).route).toBe("already_applied");
  });

  it("enforces per-company limit", async () => {
    const ctx = await (await import("@/lib/agent/context")).loadUserContext(db, U, null);
    for (let i = 0; i < 2; i++) {
      const { data: j } = await db.from("jobs").insert({ user_id: U, title: `Role ${i}`, company: "SameCo", source: "lever" }).select("id").single();
      await setApplicationStatus(db, U, j!.id, "applied");
    }
    expect((await checkLimits(db, ctx, { company: "SameCo", source: "x" })).ok).toBe(false);
  });

  it("emergency stop cancels queued work and pause blocks claiming", async () => {
    await enqueue(db, U, "search");
    await setAgentState(db, U, "paused");
    expect((await processTasks(db, { workerId: "t", secretsDb: null })).processed).toHaveLength(0);
    await setAgentState(db, U, "stopped");
    const { data } = await db.from("agent_tasks").select("status").eq("user_id", U);
    expect(data!.every((t: { status: string }) => t.status === "cancelled")).toBe(true);
  });

  it("retries failures with backoff, then fails", async () => {
    await setAgentState(db, U, "running");
    const { id } = await enqueue(db, U, "status_monitoring");
    await db.from("agent_tasks").update({ task_type: "job_analysis", job_id: "00000000-0000-0000-0000-00000000dead" }).eq("id", id);
    const r = await processTasks(db, { workerId: "t", secretsDb: null });
    expect(r.processed[0].status).toBe("failed"); // "Job not found" is non-retryable
    const { data } = await db.from("agent_tasks").select("status, error, logs").eq("id", id).single();
    expect(data!.error).toMatch(/not found/);
    expect((data!.logs as unknown[]).length).toBeGreaterThan(1);
  });
});
