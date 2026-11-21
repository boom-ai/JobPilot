// Generic, label-driven form filler for ATS application pages (Greenhouse, Lever, Ashby and similar).
// Fills only verified data. Never solves CAPTCHAs, never ticks legal declarations unless approved,
// never submits when required fields are missing.
import type { Frame, Page } from "playwright-core";

export interface FillData {
  profile: Record<string, string>;
  answers: { question: string; answer: string }[];
  coverLetter: string | null;
  resumePath: string | null;
  coverLetterPath: string | null;
}

export interface FilledField {
  label: string;
  value: string;
  kind: "text" | "file" | "select" | "checkbox" | "textarea";
}

export interface FillReport {
  filled: FilledField[];
  missing: string[];
  declarations: string[];
  unanswered: string[];
}

// label regex → profile key
const FIELD_RULES: [RegExp, string][] = [
  [/^(first|given)\s*name|^first$/i, "first_name"],
  [/^(last|family|sur)\s*name|^last$|^surname/i, "last_name"],
  [/^(full\s*)?name$|^your name|^legal name|^name\b/i, "name"],
  [/e-?mail/i, "email"],
  [/phone|mobile|contact number|whatsapp/i, "phone"],
  [/linkedin/i, "linkedin"],
  [/github/i, "github"],
  [/website|portfolio|personal (site|url)/i, "website"],
  [/^(current )?(city|location)|where are you (located|based)|current location|^address/i, "location"],
  [/current (company|employer)|most recent (company|employer)|^company$/i, "current_company"],
  [/current (title|role|position)|job title/i, "current_title"],
  [/school|university|college|institution/i, "school"],
  [/degree|qualification/i, "degree"],
  [/notice period|earliest start|start date|available to start|how soon/i, "notice_period"],
  [/expected (salary|ctc|compensation)|salary expectation|desired (salary|pay|compensation)/i, "expected_salary"],
  [/authori[sz]ed to work|work authori[sz]ation|legally (allowed|eligible)|right to work|sponsorship/i, "work_authorization"],
];

const DECLARATION_RE = /(i (hereby )?(certify|confirm|declare|attest|acknowledge|agree|consent|understand)|terms (of|and) (service|use)|privacy (policy|notice)|consent to|i have read)/i;
const SKIP_RE = /(gender|race|ethnic|veteran|disabilit|pronoun|sexual orientation|hispanic|latino)/i;

export function norm(s: string) {
  return s.toLowerCase().replace(/[*:?]/g, " ").replace(/\s+/g, " ").trim();
}

export function matchAnswer(label: string, answers: { question: string; answer: string }[]): string | null {
  const l = new Set(norm(label).split(" ").filter((w) => w.length > 2));
  let best: string | null = null;
  let score = 0;
  for (const a of answers) {
    const q = new Set(norm(a.question).split(" ").filter((w) => w.length > 2));
    let inter = 0;
    for (const w of l) if (q.has(w)) inter++;
    const s = inter / Math.max(1, Math.min(l.size, q.size));
    if (s > score) {
      score = s;
      best = a.answer;
    }
  }
  return score >= 0.6 ? best : null;
}

export function profileKeyFor(label: string): string | null {
  const l = label.trim();
  for (const [re, key] of FIELD_RULES) if (re.test(l)) return key;
  return null;
}

interface FieldInfo {
  idx: number;
  tag: string;
  type: string;
  label: string;
  required: boolean;
  value: string;
  checked: boolean;
  options: string[];
}

/** Collect visible form fields with their human labels from a frame. */
async function collectFields(frame: Frame | Page): Promise<FieldInfo[]> {
  return frame.evaluate(() => {
    const els = Array.from(document.querySelectorAll("input, textarea, select")) as (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[];
    const out: FieldInfo[] = [];
    const textOf = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    els.forEach((el, idx) => {
      const type = (el.getAttribute("type") ?? el.tagName).toLowerCase();
      if (["hidden", "submit", "button", "image", "reset", "search"].includes(type)) return;
      const style = window.getComputedStyle(el);
      const visible = el.offsetParent !== null || type === "file" || style.position === "fixed";
      if (!visible && type !== "file") return;
      let label = "";
      if (el.id) label = textOf(document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
      if (!label) label = textOf(el.closest("label"));
      if (!label) label = el.getAttribute("aria-label") ?? "";
      if (!label) {
        const lb = el.getAttribute("aria-labelledby");
        if (lb) label = lb.split(" ").map((i) => textOf(document.getElementById(i))).join(" ");
      }
      if (!label) {
        // nearest preceding label-ish text in the field's container
        const box = el.closest("div, fieldset, li");
        const lab = box?.querySelector("label, legend, .label, [class*=label], [class*=question]");
        label = textOf(lab ?? null);
      }
      if (!label) label = el.getAttribute("placeholder") ?? el.getAttribute("name") ?? "";
      el.setAttribute("data-jp-idx", String(idx));
      out.push({
        idx,
        tag: el.tagName.toLowerCase(),
        type,
        label: label.slice(0, 300),
        required: el.required || el.getAttribute("aria-required") === "true" || /\*\s*$/.test(label),
        value: type === "file" ? ((el as HTMLInputElement).files?.length ? "file" : "") : (el as HTMLInputElement).value ?? "",
        checked: (el as HTMLInputElement).checked ?? false,
        options: el.tagName === "SELECT" ? Array.from((el as HTMLSelectElement).options).map((o) => o.text) : [],
      });
    });
    return out;
  });
}

export async function fillForm(target: Page, data: FillData, opts: { approveDeclarations: boolean }): Promise<FillReport> {
  const report: FillReport = { filled: [], missing: [], declarations: [], unanswered: [] };
  const frames = [target.mainFrame(), ...target.frames().filter((f) => f !== target.mainFrame() && /greenhouse|lever|ashby|apply|job/i.test(f.url()))];
  for (const frame of frames) {
    let fields: FieldInfo[];
    try {
      fields = await collectFields(frame);
    } catch {
      continue;
    }
    for (const f of fields) {
      const sel = `[data-jp-idx="${f.idx}"]`;
      const label = f.label.replace(/\s*\*\s*$/, "").trim();
      const loc = frame.locator(sel).first();
      try {
        if (f.type === "file") {
          if (f.value) continue;
          const isCover = /cover/i.test(label);
          const path = isCover ? data.coverLetterPath : /resume|cv|curriculum/i.test(label) || !label ? data.resumePath : null;
          if (path) {
            await loc.setInputFiles(path);
            report.filled.push({ label: label || "Resume", value: path.split(/[\\/]/).pop()!, kind: "file" });
          } else if (f.required) report.missing.push(label || "File upload");
          continue;
        }
        if (f.type === "checkbox" || f.type === "radio") {
          if (DECLARATION_RE.test(label)) {
            report.declarations.push(label.slice(0, 160));
            if (opts.approveDeclarations && !f.checked && f.type === "checkbox") {
              await loc.check({ force: true });
              report.filled.push({ label: label.slice(0, 80), value: "✓ (approved declaration)", kind: "checkbox" });
            }
          }
          continue; // other checkboxes/radios need human judgement
        }
        if (f.value && f.value.trim()) continue; // already filled (e.g. autofill)
        if (SKIP_RE.test(label)) continue; // voluntary self-identification: never auto-answer
        let value: string | null = null;
        const key = profileKeyFor(label);
        if (key) value = data.profile[key] || null;
        if (!value && /cover letter/i.test(label) && f.tag === "textarea") value = data.coverLetter;
        if (!value && label.length > 12) value = matchAnswer(label, data.answers);
        if (f.tag === "select") {
          if (value) {
            const opt = f.options.find((o) => norm(o) === norm(value!)) ?? f.options.find((o) => norm(o).includes(norm(value!)) || norm(value!).includes(norm(o)));
            if (opt) {
              await loc.selectOption({ label: opt });
              report.filled.push({ label, value: opt, kind: "select" });
              continue;
            }
          }
          if (f.required) report.missing.push(label);
          continue;
        }
        if (value) {
          await loc.fill(value);
          report.filled.push({ label: label.slice(0, 80), value: value.length > 80 ? value.slice(0, 77) + "…" : value, kind: f.tag === "textarea" ? "textarea" : "text" });
        } else if (f.required) {
          report.missing.push(label || "(unlabelled required field)");
          if (label.length > 12) report.unanswered.push(label);
        }
      } catch {
        if (f.required) report.missing.push(label);
      }
    }
  }
  // Re-check required fields after filling (some forms validate on change)
  report.missing = [...new Set(report.missing)];
  return report;
}

export async function detectCaptcha(page: Page): Promise<string | null> {
  for (const f of page.frames()) {
    const u = f.url();
    if (/recaptcha\/api2\/anchor|recaptcha\/enterprise\/anchor/.test(u)) return "reCAPTCHA";
    if (/hcaptcha\.com/.test(u)) return "hCaptcha";
    if (/challenges\.cloudflare\.com/.test(u)) return "Cloudflare Turnstile";
  }
  const sel = await page.$(".g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]");
  return sel ? "CAPTCHA" : null;
}

export async function captchaSolved(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const names = ["g-recaptcha-response", "h-captcha-response", "cf-turnstile-response"];
    const els = names.flatMap((n) => Array.from(document.querySelectorAll(`[name="${n}"]`))) as HTMLTextAreaElement[];
    return els.length > 0 && els.every((e) => e.value && e.value.length > 20);
  });
}

export async function detectMfaOrLogin(page: Page): Promise<boolean> {
  return page.evaluate(() => /verification code|two-factor|2fa|one-time password|sign in to continue|log in to apply/i.test(document.body?.innerText ?? ""));
}

const CONFIRM_RE = /(thank you for (applying|your application)|application (has been )?(received|submitted)|we('ve| have) received your application|successfully (submitted|applied)|your application was submitted)/i;

export async function clickSubmit(page: Page): Promise<boolean> {
  const candidates = [
    'button[type="submit"]:visible',
    'input[type="submit"]:visible',
    'button:has-text("Submit application"):visible',
    'button:has-text("Submit Application"):visible',
    'button:has-text("Submit"):visible',
  ];
  for (const c of candidates) {
    const b = page.locator(c).first();
    if (await b.count()) {
      await b.click();
      return true;
    }
  }
  return false;
}

export async function waitForConfirmation(page: Page, timeoutMs = 20000): Promise<{ confirmed: boolean; text: string; url: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = (await page.evaluate(() => document.body?.innerText ?? "").catch(() => "")) as string;
    const m = CONFIRM_RE.exec(text);
    if (m || /\/(thanks|thank-you|confirmation|submitted)\b/i.test(page.url())) {
      const idx = m?.index ?? 0;
      return { confirmed: true, text: text.slice(Math.max(0, idx - 60), idx + 200).trim(), url: page.url() };
    }
    await page.waitForTimeout(700);
  }
  return { confirmed: false, text: "", url: page.url() };
}

export function applyUrlFor(ats: string, url: string): string {
  if (ats === "lever" && !/\/apply\/?$/.test(url)) return url.replace(/\/?$/, "/apply");
  if (ats === "ashby" && !/\/application\/?$/.test(url)) return url.replace(/\/?$/, "/application");
  return url;
}
