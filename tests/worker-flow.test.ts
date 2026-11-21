import { describe, expect, it, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import { memoryDb, LOCAL_USER_ID as U } from "@/lib/supabase/localdb";
import type { DB } from "@/lib/supabase/clients";
import { seedDefaults } from "@/lib/agent/pipeline";
import { processTasks } from "@/lib/agent/runner";
import { enqueue, setAgentState } from "@/lib/agent/queue";
import { createTailoredResume, createLetter, createAnswers } from "@/lib/agent/services";
import { loadUserContext } from "@/lib/agent/context";
import { mergeSettings, DEFAULT_PREFERENCES } from "@/lib/defaults";
import { makeBrowserHandler } from "../worker/ats-handler";
import { sampleProfile } from "./helpers";

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
let browser: Browser | null = null;
afterAll(async () => browser?.close());

describe.skipIf(!fs.existsSync(CHROME))("browser worker flow (local DB + real Chrome)", () => {
  it("assisted fill → awaiting approval → approve → submit → applied with evidence", async () => {
    const db = memoryDb() as unknown as DB;
    await db.from("user_profiles").insert({ user_id: U, profile_data: sampleProfile(), preferences: { ...DEFAULT_PREFERENCES, notice_period: "Immediate", work_authorization: "Yes" }, settings: mergeSettings({ automation: { ...mergeSettings({}).automation, mode: "assisted" } }) });
    await seedDefaults(db, U);
    const url = "file://" + path.join(__dirname, "forms", "greenhouse.html");
    const { data: job } = await db.from("jobs").insert({ user_id: U, title: "AI Data Annotation Specialist", company: "Scale AI", source: "greenhouse", source_url: url, apply_url: url, match_score: 88, description: "Annotate data. RLHF." }).select("id").single();
    const ctx = await loadUserContext(db, U, null);
    await createTailoredResume(db, ctx, job!.id);
    await createLetter(db, ctx, job!.id);
    await createAnswers(db, ctx, job!.id, ["Why are you interested in this role?"]);
    await db.from("application_answers").update({ approved: true }).eq("job_id", job!.id);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jpw-"));
    const handler = makeBrowserHandler(async () => {
      browser ??= await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
      return browser.newContext();
    }, dir);

    // 1) assisted fill: must NOT submit
    await enqueue(db, U, "application_submission", { jobId: job!.id, requiresBrowser: true, payload: { ats: "greenhouse", autoSubmit: false } });
    const r1 = await processTasks(db, { workerId: "t", allowBrowser: true, browserHandler: handler, secretsDb: null });
    expect(r1.processed[0]).toMatchObject({ type: "application_submission", status: "waiting_user" });
    const { data: app1 } = await db.from("applications").select("id, application_status, review_data").eq("job_id", job!.id).single();
    expect(app1!.application_status).toBe("awaiting_approval");
    const review = app1!.review_data as { filled: { label: string }[]; declarations: string[]; missing: string[] };
    expect(review.filled.length).toBeGreaterThan(5);
    expect(review.declarations.length).toBe(1);

    // 2) user approves incl. declarations → submit + confirmation
    await enqueue(db, U, "application_submission", { jobId: job!.id, requiresBrowser: true, dedupe: false, payload: { ats: "greenhouse", approved: true, approveDeclarations: true } });
    const r2 = await processTasks(db, { workerId: "t", allowBrowser: true, browserHandler: handler, secretsDb: null });
    expect(r2.processed[0]).toMatchObject({ status: "completed" });
    const { data: app2 } = await db.from("applications").select("application_status, submission_evidence, applied_at").eq("job_id", job!.id).single();
    expect(app2!.application_status).toBe("applied");
    expect((app2!.submission_evidence as { kind: string; text: string }).kind).toBe("confirmation_page");
    expect((app2!.submission_evidence as { text: string }).text).toMatch(/Thank you/);
    expect(app2!.applied_at).toBeTruthy();

    // 3) emergency stop prevents further browser work
    await enqueue(db, U, "application_submission", { jobId: job!.id, requiresBrowser: true, dedupe: false, payload: { ats: "greenhouse", approved: true } });
    await setAgentState(db, U, "stopped");
    const r3 = await processTasks(db, { workerId: "t", allowBrowser: true, browserHandler: handler, secretsDb: null });
    expect(r3.processed).toHaveLength(0);
  }, 60000);
});
