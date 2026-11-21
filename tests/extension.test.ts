import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { chromium, type Browser } from "playwright-core";

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const EXT = path.join(__dirname, "..", "extension");
const form = (f: string) => "file://" + path.join(__dirname, "forms", f);

describe.skipIf(!fs.existsSync(CHROME))("Chrome extension", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
  });
  afterAll(async () => browser?.close());

  async function withScripts(url: string) {
    const page = await browser.newPage();
    await page.goto(url);
    await page.addScriptTag({ path: path.join(EXT, "page-scripts.js") });
    return page;
  }

  it("extracts JobPosting JSON-LD", async () => {
    const page = await withScripts(form("jobposting.html"));
    const job = await page.evaluate(() => (window as unknown as { jpExtractJob: () => Record<string, unknown> }).jpExtractJob());
    expect(job).toMatchObject({ title: "LLM Evaluator", company: "Acme AI", remote_type: "remote", is_job: true });
    expect(String(job.location)).toContain("Bengaluru");
    await page.close();
  });

  it("extracts from site markup without JSON-LD (fallback)", async () => {
    const page = await withScripts(form("indeed_like.html"));
    const job = await page.evaluate(() => (window as unknown as { jpExtractJob: () => Record<string, unknown> }).jpExtractJob());
    expect(job.title).toBe("Data Annotator");
    expect(String(job.description)).toContain("label images");
    await page.close();
  });

  it("fills a form, attaches resume, leaves declarations and never submits", async () => {
    const page = await withScripts(form("greenhouse.html"));
    const report = await page.evaluate(async () => {
      const w = window as unknown as { jpFillForm: (p: unknown) => Promise<{ filled: string[]; missing: string[]; declarations: string[]; uploaded: boolean; captcha: boolean }> };
      return w.jpFillForm({
        profile: { first_name: "Sanket", last_name: "Sharma", email: "s@x.com", phone: "+91", notice_period: "Immediate", work_authorization: "Yes" },
        answers: [{ question: "Why are you interested in this role?", answer: "Because…" }],
        coverLetter: null,
        resume: { name: "Resume.pdf", base64: btoa("%PDF-1.4 x") },
        approveDeclarations: false,
      });
    });
    expect(report.uploaded).toBe(true);
    expect(report.filled.length).toBeGreaterThanOrEqual(6);
    expect(report.declarations.length).toBe(1);
    expect(await page.isChecked("#cert")).toBe(false);
    expect(await page.inputValue("#auth")).toBe("Yes");
    expect(await page.evaluate(() => (document.getElementById("resume") as HTMLInputElement).files?.[0]?.name)).toBe("Resume.pdf");
    expect(await page.locator("h1").innerText()).toBe("AI Data Annotation Specialist"); // still on the form: not submitted
    await page.close();
  });

  it("loads unpacked in Chrome and renders the popup", async () => {
    const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "jpext-"));
    const ctx = await chromium.launchPersistentContext(userDir, {
      executablePath: CHROME,
      headless: false,
      args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    // Unpacked extension id = first 32 hex of sha256(abs path) mapped 0-f → a-p
    const id = crypto.createHash("sha256").update(path.resolve(EXT)).digest("hex").slice(0, 32).replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`chrome-extension://${id}/popup.html`);
    await page.waitForTimeout(800);
    expect(await page.locator("#view-settings").isVisible()).toBe(true);
    expect(await page.locator(".brand").innerText()).toContain("Job Pilot AI");
    expect(errors).toEqual([]);
    await ctx.close();
  }, 30000);
});
