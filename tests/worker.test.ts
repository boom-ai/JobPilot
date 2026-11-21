import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import { fillForm, detectCaptcha, captchaSolved, clickSubmit, waitForConfirmation, matchAnswer, profileKeyFor, applyUrlFor } from "../worker/form-filler";

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const hasChrome = fs.existsSync(CHROME);
const formUrl = (f: string) => "file://" + path.join(__dirname, "forms", f);
const resume = path.join(os.tmpdir(), "jp_resume_test.pdf");
fs.writeFileSync(resume, "%PDF-1.4 test");
const data = {
  profile: { first_name: "Sanket", last_name: "Sharma", name: "Sanket Sharma", email: "sanketsharma8083@gmail.com", phone: "+91-7973798820", linkedin: "", current_company: "Innodata India Pvt. Ltd.", notice_period: "Immediate", work_authorization: "Yes" },
  answers: [{ question: "Why are you interested in this role?", answer: "It matches my LLM evaluation work." }],
  coverLetter: "Dear team…",
  resumePath: resume,
  coverLetterPath: null,
};

describe("form filler helpers", () => {
  it("maps labels to profile keys", () => {
    expect(profileKeyFor("First Name *")).toBe("first_name");
    expect(profileKeyFor("Email address")).toBe("email");
    expect(profileKeyFor("Are you legally authorized to work in India?")).toBe("work_authorization");
    expect(profileKeyFor("Favourite colour")).toBeNull();
  });
  it("fuzzy-matches questions to answers", () => {
    expect(matchAnswer("Why are you interested in this role? *", data.answers)).toBe(data.answers[0].answer);
    expect(matchAnswer("Describe your biggest failure", data.answers)).toBeNull();
  });
  it("builds ATS apply URLs", () => {
    expect(applyUrlFor("lever", "https://jobs.lever.co/acme/123")).toBe("https://jobs.lever.co/acme/123/apply");
    expect(applyUrlFor("ashby", "https://jobs.ashbyhq.com/acme/9f8e")).toBe("https://jobs.ashbyhq.com/acme/9f8e/application");
  });
});

describe.skipIf(!hasChrome)("form filler in real Chrome", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
  });
  afterAll(async () => browser?.close());

  it("fills a Greenhouse-style form, skips self-ID, holds declarations, submits and detects confirmation", async () => {
    const page = await browser.newPage();
    await page.goto(formUrl("greenhouse.html"));
    const r = await fillForm(page, data, { approveDeclarations: false });
    const labels = r.filled.map((f) => f.label);
    expect(labels).toEqual(expect.arrayContaining(["First Name", "Last Name", "Email", "Phone", "Resume/CV", "What is your notice period?", "Why are you interested in this role?"]));
    expect(await page.inputValue("#first_name")).toBe("Sanket");
    expect(await page.inputValue("#q1")).toBe("Immediate");
    expect(await page.inputValue("#auth")).toBe("Yes");
    expect(await page.inputValue("#gender")).toBe(""); // voluntary self-ID untouched
    expect(r.declarations[0]).toMatch(/I certify/);
    expect(await page.isChecked("#cert")).toBe(false); // not approved → not ticked
    expect(r.missing).toEqual([]);
    // approved run ticks the declaration
    const r2 = await fillForm(page, data, { approveDeclarations: true });
    expect(await page.isChecked("#cert")).toBe(true);
    expect(r2.filled.some((f) => f.kind === "checkbox")).toBe(true);
    expect(await detectCaptcha(page)).toBeNull();
    expect(await clickSubmit(page)).toBe(true);
    const c = await waitForConfirmation(page, 5000);
    expect(c.confirmed).toBe(true);
    expect(c.text).toMatch(/Thank you for applying/);
    await page.close();
  });

  it("reports unanswerable required fields and detects CAPTCHA without solving it", async () => {
    const page = await browser.newPage();
    await page.goto(formUrl("lever_captcha.html"));
    const r = await fillForm(page, data, { approveDeclarations: false });
    expect(await page.inputValue('[name="name"]')).toBe("Sanket Sharma");
    expect(await page.inputValue('[name="org"]')).toBe("Innodata India Pvt. Ltd.");
    expect(r.missing).toContain("Describe a time you disagreed with a guideline");
    expect(await detectCaptcha(page)).toBe("CAPTCHA");
    expect(await captchaSolved(page)).toBe(false);
    // simulate the human solving it
    await page.evaluate(() => ((document.querySelector('[name="g-recaptcha-response"]') as HTMLTextAreaElement).value = "x".repeat(40)));
    expect(await captchaSolved(page)).toBe(true);
    await page.close();
  });

  it("does not report confirmation when none appears", async () => {
    const page = await browser.newPage();
    await page.setContent("<form><input required><button type=submit>Submit</button></form>");
    await clickSubmit(page);
    expect((await waitForConfirmation(page, 1500)).confirmed).toBe(false);
    await page.close();
  });
});
