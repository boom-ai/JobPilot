// Browser task handler: assisted fill → approval, or auto-submit where permitted.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import type { DB } from "../src/lib/supabase/clients";
import type { UserContext } from "../src/lib/agent/context";
import type { AgentTask, TaskLogger } from "../src/lib/agent/queue";
import { isCancelled } from "../src/lib/agent/queue";
import { extensionContext } from "../src/lib/ext";
import { resumeToPdf, textToPdf } from "../src/lib/resume/export";
import type { TailoredResume } from "../src/lib/resume/tailor";
import { setApplicationStatus } from "../src/lib/agent/records";
import { logEvent, notify } from "../src/lib/agent/events";
import { checkLimits, supportedAts } from "../src/lib/agent/services";
import { applyUrlFor, captchaSolved, clickSubmit, detectCaptcha, detectMfaOrLogin, fillForm, waitForConfirmation } from "./form-filler";

type Outcome = { status: "completed" | "waiting_user"; result: Record<string, unknown>; reason?: string };

export function makeBrowserHandler(getContext: () => Promise<BrowserContext>, dataDir: string) {
  return async function handle(db: DB, ctx: UserContext, task: AgentTask, logger: TaskLogger): Promise<Outcome> {
    const jobId = task.job_id!;
    const p = task.payload as { autoSubmit?: boolean; approved?: boolean; approveDeclarations?: boolean; ats?: string };
    const { data: job } = await db.from("jobs").select("id, title, company, source, apply_url, source_url, match_score").eq("id", jobId).single();
    if (!job) throw new Error("Job not found");
    const ats = supportedAts(job.apply_url ?? job.source_url) ?? p.ats;
    if (!ats || !ctx.settings.automation.allowed_auto_sources.includes(ats)) throw new Error(`Automated forms are not enabled for this site (${ats ?? "unsupported"}). Apply manually or with the extension.`);
    const ectx = await extensionContext(db, ctx, jobId);
    if (["applied", "application_confirmed", "interview", "offer"].includes(ectx.application?.application_status ?? "")) return { status: "completed", result: { skipped: "already applied" } };

    // documents
    const dir = path.join(dataDir, "docs", jobId);
    fs.mkdirSync(dir, { recursive: true });
    let resumePath: string | null = null;
    const { data: ver } = await db.from("resume_versions").select("generated_content, file_name").eq("job_id", jobId).eq("user_id", ctx.userId).order("version", { ascending: false }).limit(1);
    if (ver?.[0]) {
      resumePath = path.join(dir, `${ver[0].file_name}.pdf`);
      fs.writeFileSync(resumePath, await resumeToPdf(ver[0].generated_content as TailoredResume));
    }
    let coverLetterPath: string | null = null;
    if (ectx.cover_letter) {
      coverLetterPath = path.join(dir, `CoverLetter_${job.company.replace(/\W+/g, "_")}.pdf`);
      fs.writeFileSync(coverLetterPath, await textToPdf("Cover letter", ectx.cover_letter));
    }

    const url = applyUrlFor(ats, job.apply_url ?? job.source_url!);
    await logger.log(`Opening ${url}`, true);
    const context = await getContext();
    const page: Page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1500);
      if (ats === "greenhouse") {
        const applyBtn = page.locator('a:has-text("Apply"), button:has-text("Apply for this job"), button:has-text("Apply")').first();
        if ((await page.locator("form#application-form, form#application_form, #application").count()) === 0 && (await applyBtn.count())) await applyBtn.click().catch(() => {});
        await page.waitForTimeout(1000);
      }
      if (await detectMfaOrLogin(page)) {
        await notify(db, ctx.userId, ctx.settings, { type: "failure", title: `Sign-in needed: ${job.company}`, content: "The application page asks you to sign in or verify. Complete it in the worker browser, then retry the task.", link: "/queue" });
        return { status: "waiting_user", result: { url }, reason: "Login / MFA required — complete it in the worker browser, then Retry" };
      }
      const profile = Object.fromEntries(Object.entries(ectx.profile).map(([k, v]) => [k, String(v ?? "")]));
      const report = await fillForm(page, { profile, answers: [...ectx.answers.filter((a) => a.approved || !(a.flags ?? []).length), ...ectx.library], coverLetter: ectx.cover_letter, resumePath, coverLetterPath }, { approveDeclarations: !!p.approveDeclarations || ctx.settings.automation.approve_declarations });
      await logger.log(`Filled ${report.filled.length} fields; missing required: ${report.missing.length}; declarations: ${report.declarations.length}`, true);
      const shot = path.join(dir, `filled_${Date.now()}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      if (await isCancelled(db, task.id)) return { status: "completed", result: { aborted: "cancelled by user before submission" } };

      const declarationsBlock = report.declarations.length > 0 && !(p.approveDeclarations || ctx.settings.automation.approve_declarations);
      const wantSubmit = !!p.approved || (!!p.autoSubmit && (job.match_score ?? 0) >= ctx.settings.automation.auto_apply_min_score);
      const review = { filled: report.filled, missing: report.missing, declarations: report.declarations, screenshot: shot, url, ats };

      if (!wantSubmit || report.missing.length || declarationsBlock) {
        const why = report.missing.length ? `Missing required fields: ${report.missing.join(", ")}` : declarationsBlock ? "Legal declarations need your approval" : "Assisted mode — review before submitting";
        await setApplicationStatus(db, ctx.userId, jobId, "awaiting_approval", { by: "agent", note: why, extra: { review_data: review, mode: p.autoSubmit ? "auto" : "assisted" } });
        await notify(db, ctx.userId, ctx.settings, { type: "application", title: `Review before submitting: ${job.title} — ${job.company}`, content: why, link: "/queue" });
        await logEvent(db, ctx.userId, "application_awaiting_approval", `Application awaiting approval: ${job.title} — ${job.company}`, { job_id: jobId }, task.id);
        return { status: "waiting_user", result: review, reason: why };
      }

      const limits = await checkLimits(db, ctx, job);
      if (!limits.ok) {
        await setApplicationStatus(db, ctx.userId, jobId, "awaiting_approval", { by: "agent", note: limits.reason, extra: { review_data: review } });
        return { status: "waiting_user", result: review, reason: limits.reason };
      }

      const captcha = await detectCaptcha(page);
      if (captcha) {
        const waitMin = ctx.settings.automation.captcha_wait_minutes;
        await logger.log(`${captcha} present — waiting up to ${waitMin} min for you to solve it in the worker browser (never solved automatically)`, true);
        await notify(db, ctx.userId, ctx.settings, { type: "application", title: `Solve the ${captcha}: ${job.company}`, content: `The worker browser is waiting on the application form. It will submit once you solve it (up to ${waitMin} min).`, link: "/queue" });
        await page.bringToFront().catch(() => {});
        const deadline = Date.now() + waitMin * 60_000;
        let solved = false;
        while (Date.now() < deadline) {
          if (await isCancelled(db, task.id)) return { status: "completed", result: { aborted: "cancelled during CAPTCHA wait" } };
          if (await captchaSolved(page).catch(() => false)) {
            solved = true;
            break;
          }
          await page.waitForTimeout(3000);
        }
        if (!solved) {
          await setApplicationStatus(db, ctx.userId, jobId, "awaiting_approval", { by: "agent", note: `${captcha} not solved in time`, extra: { review_data: review } });
          return { status: "waiting_user", result: review, reason: `${captcha} not solved within ${waitMin} minutes — approve again to retry` };
        }
      }

      if (await isCancelled(db, task.id)) return { status: "completed", result: { aborted: "cancelled before submit" } };
      const clicked = await clickSubmit(page);
      if (!clicked) {
        await setApplicationStatus(db, ctx.userId, jobId, "awaiting_approval", { by: "agent", note: "Could not find the submit button", extra: { review_data: review } });
        return { status: "waiting_user", result: review, reason: "Submit button not found — submit manually in the worker browser" };
      }
      await logger.log("Submit clicked — waiting for confirmation", true);
      const conf = await waitForConfirmation(page);
      const after = path.join(dir, `after_submit_${Date.now()}.png`);
      await page.screenshot({ path: after, fullPage: true }).catch(() => {});
      if (!conf.confirmed) {
        // Do NOT claim submission without evidence.
        await setApplicationStatus(db, ctx.userId, jobId, "awaiting_approval", { by: "agent", note: "Submit clicked but no confirmation was detected — please verify on the site", extra: { review_data: { ...review, after_screenshot: after } } });
        await notify(db, ctx.userId, ctx.settings, { type: "failure", title: `Verify submission: ${job.company}`, content: "No confirmation page detected after clicking submit (validation error?). Check the worker browser.", link: "/queue" });
        return { status: "waiting_user", result: { ...review, after_screenshot: after }, reason: "No confirmation detected after submit" };
      }
      await setApplicationStatus(db, ctx.userId, jobId, "applied", {
        by: "agent",
        note: "Submitted by browser worker; confirmation detected",
        extra: { submission_evidence: { kind: "confirmation_page", url: conf.url, text: conf.text, screenshot: after, at: new Date().toISOString() }, mode: p.approved ? "assisted" : "auto", review_data: null },
      });
      await logEvent(db, ctx.userId, "application_submitted", `Application submitted: ${job.title} — ${job.company} (confirmation detected)`, { job_id: jobId }, task.id);
      await notify(db, ctx.userId, ctx.settings, { type: "application", title: `Applied: ${job.title} — ${job.company}`, content: conf.text.slice(0, 200), link: `/jobs/${jobId}?tab=apply` });
      return { status: "completed", result: { submitted: true, confirmation: conf } };
    } finally {
      // keep the page open for a moment when waiting on the user; otherwise close
      if (!page.isClosed()) await page.close().catch(() => {});
    }
  };
}

export function defaultDataDir() {
  return process.env.JOBPILOT_WORKER_DIR ?? path.join(process.cwd(), "worker-data");
}

export const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "jp-"));
