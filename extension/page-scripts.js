// Functions injected into the active tab with chrome.scripting.executeScript.
// Each must be fully self-contained (no references to outer scope).

/* eslint-disable no-unused-vars */

/** Extract job details from the current page: JSON-LD JobPosting first, then site-specific selectors, then generic fallback. */
function jpExtractJob() {
  const txt = (el) => (el ? el.innerText || el.textContent || "" : "").replace(/\s+\n/g, "\n").trim();
  const q = (sel) => document.querySelector(sel);
  const host = location.hostname.replace(/^www\./, "");
  const out = { url: location.href, site: host.split(".").slice(-2, -1)[0] || host, title: "", company: "", location: "", description: "", salary_text: "", remote_type: undefined, posted_at: null };
  // 1) schema.org JobPosting
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      let d = JSON.parse(s.textContent);
      const items = (Array.isArray(d) ? d : [d]).flatMap((x) => (x && x["@graph"] ? x["@graph"] : [x]));
      const jp = items.find((i) => i && (i["@type"] === "JobPosting" || (Array.isArray(i["@type"]) && i["@type"].includes("JobPosting"))));
      if (jp) {
        const div = document.createElement("div");
        div.innerHTML = jp.description || "";
        out.title = jp.title || "";
        out.company = (jp.hiringOrganization && jp.hiringOrganization.name) || "";
        const loc = [].concat(jp.jobLocation || [])[0];
        out.location = loc && loc.address ? [loc.address.addressLocality, loc.address.addressRegion, typeof loc.address.addressCountry === "object" ? loc.address.addressCountry.name : loc.address.addressCountry].filter(Boolean).join(", ") : "";
        out.description = div.innerText.trim();
        if (jp.jobLocationType === "TELECOMMUTE") out.remote_type = "remote";
        out.posted_at = jp.datePosted || null;
        out.is_job = true; // structured JobPosting data is authoritative
        if (out.title && out.company) return out;
      }
    } catch (e) {}
  }
  // 2) site-specific (best effort — job boards change their markup often)
  const sites = {
    "linkedin.com": { title: ".job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1", company: ".job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name", location: ".job-details-jobs-unified-top-card__primary-description-container, .jobs-unified-top-card__bullet", desc: "#job-details, .jobs-description__content" },
    "naukri.com": { title: "h1", company: "[class*='jd-header-comp-name'] a, [class*='comp-name']", location: "[class*='location'] a, [class*='loc']", desc: "[class*='dang-inner-html'], [class*='job-desc']" },
    "indeed.com": { title: "[data-testid='jobsearch-JobInfoHeader-title'], h1", company: "[data-testid='inlineHeader-companyName'], [data-company-name]", location: "[data-testid='inlineHeader-companyLocation'], [data-testid='job-location']", desc: "#jobDescriptionText" },
    "foundit.in": { title: "h1", company: "[class*='company'] a, [class*='companyName']", location: "[class*='location']", desc: "[class*='jobDescInfo'], [class*='job-description']" },
    "wellfound.com": { title: "h1", company: "a[href*='/company/'] h2, a[href*='/company/']", location: "[class*='location']", desc: "[class*='description']" },
    "glassdoor.co.in": { title: "[data-test='job-title'], h1", company: "[data-test='employer-name']", location: "[data-test='location']", desc: "[class*='JobDetails_jobDescription']" },
    "greenhouse.io": { title: "h1, .app-title", company: ".company-name, [class*='company']", location: ".location, [class*='location']", desc: "#content, .job__description, [class*='description']" },
    "lever.co": { title: ".posting-headline h2, h2", company: ".main-header-logo img[alt], title", location: ".posting-categories .location, .location", desc: ".section-wrapper.page-full-width, .content" },
    "ashbyhq.com": { title: "h1", company: "title", location: "[class*='location']", desc: "[class*='description'], main" },
  };
  const key = Object.keys(sites).find((k) => host.endsWith(k));
  const pick = (sel) => {
    for (const s of (sel || "").split(",")) {
      const el = q(s.trim());
      if (el) return el.tagName === "IMG" ? el.getAttribute("alt") : el.tagName === "TITLE" ? document.title.split(/[|–-]/).pop() : txt(el);
    }
    return "";
  };
  if (key) {
    const s = sites[key];
    out.title = out.title || pick(s.title);
    out.company = out.company || pick(s.company);
    out.location = out.location || pick(s.location);
    out.description = out.description || pick(s.desc);
  }
  // 3) generic fallback
  if (!out.title) out.title = txt(q("h1")) || document.title.split(/[|–-]/)[0].trim();
  if (!out.company) out.company = (q("meta[property='og:site_name']") && q("meta[property='og:site_name']").content) || "";
  if (!out.description) out.description = txt(q("main") || q("article") || document.body).slice(0, 30000);
  out.title = out.title.split("\n")[0].trim().slice(0, 200);
  out.company = out.company.split("\n")[0].trim().slice(0, 120);
  out.location = out.location.split("\n")[0].trim().slice(0, 160);
  if (/remote|work from home/i.test(out.location)) out.remote_type = "remote";
  const looksLikeJob = /(responsibilit|requirement|qualification|experience|apply|job description|about the role)/i.test(out.description);
  out.is_job = !!out.title && looksLikeJob;
  return out;
}

/** Fill the application form on the page. Never clicks submit; highlights it instead. */
async function jpFillForm(payload) {
  const { profile, answers, coverLetter, resume, approveDeclarations } = payload;
  const RULES = [
    [/^(first|given)\s*name|^first$/i, "first_name"], [/^(last|family|sur)\s*name|^last$/i, "last_name"], [/^(full\s*)?name$|^your name|^legal name|^name\b/i, "name"],
    [/e-?mail/i, "email"], [/phone|mobile|contact number|whatsapp/i, "phone"], [/linkedin/i, "linkedin"], [/github/i, "github"], [/website|portfolio/i, "website"],
    [/^(current )?(city|location)|current location|where are you (located|based)/i, "location"], [/current (company|employer)|^company$/i, "current_company"],
    [/current (title|role|position)|job title/i, "current_title"], [/school|university|college|institution/i, "school"], [/degree|qualification/i, "degree"],
    [/notice period|earliest start|how soon|available to start/i, "notice_period"], [/expected (salary|ctc)|salary expectation|desired (salary|pay)/i, "expected_salary"],
    [/authori[sz]ed to work|work authori[sz]ation|right to work|sponsorship/i, "work_authorization"],
  ];
  const DECL = /(i (hereby )?(certify|confirm|declare|attest|acknowledge|agree|consent)|terms (of|and)|privacy (policy|notice)|i have read)/i;
  const SKIP = /(gender|race|ethnic|veteran|disabilit|pronoun|sexual orientation|caste|religion)/i;
  const norm = (s) => (s || "").toLowerCase().replace(/[*:?]/g, " ").replace(/\s+/g, " ").trim();
  const labelOf = (el) => {
    let l = "";
    if (el.id) { const lb = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (lb) l = lb.innerText; }
    if (!l && el.closest("label")) l = el.closest("label").innerText;
    if (!l) l = el.getAttribute("aria-label") || "";
    if (!l && el.getAttribute("aria-labelledby")) l = el.getAttribute("aria-labelledby").split(" ").map((i) => (document.getElementById(i) || {}).innerText || "").join(" ");
    if (!l) { const box = el.closest("div, fieldset, li"); const lab = box && box.querySelector("label, legend, [class*=label], [class*=question]"); if (lab) l = lab.innerText; }
    if (!l) l = el.getAttribute("placeholder") || el.getAttribute("name") || "";
    return l.replace(/\s+/g, " ").trim();
  };
  const answerFor = (label) => {
    const L = new Set(norm(label).split(" ").filter((w) => w.length > 2));
    let best = null, score = 0;
    for (const a of answers) {
      const Q = new Set(norm(a.question).split(" ").filter((w) => w.length > 2));
      let inter = 0; for (const w of L) if (Q.has(w)) inter++;
      const s = inter / Math.max(1, Math.min(L.size, Q.size));
      if (s > score) { score = s; best = a.answer; }
    }
    return score >= 0.6 ? best : null;
  };
  const setValue = (el, v) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, v); // works with React-controlled inputs
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.style.outline = "2px solid #7c7cf0";
  };
  const report = { filled: [], missing: [], declarations: [], uploaded: false };
  const els = Array.from(document.querySelectorAll("input, textarea, select"));
  for (const el of els) {
    const type = (el.getAttribute("type") || el.tagName).toLowerCase();
    if (["hidden", "submit", "button", "image", "reset", "search", "password"].includes(type)) continue;
    if (el.offsetParent === null && type !== "file") continue;
    const label = labelOf(el).replace(/\s*\*\s*$/, "");
    const required = el.required || el.getAttribute("aria-required") === "true";
    try {
      if (type === "file") {
        if (el.files && el.files.length) continue;
        if (resume && (/resume|cv/i.test(label) || !/cover/i.test(label))) {
          const bytes = Uint8Array.from(atob(resume.base64), (c) => c.charCodeAt(0));
          const dt = new DataTransfer();
          dt.items.add(new File([bytes], resume.name, { type: "application/pdf" }));
          el.files = dt.files;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          report.filled.push(`${label || "Resume"}: ${resume.name}`);
          report.uploaded = true;
        } else if (required) report.missing.push(label || "File upload");
        continue;
      }
      if (type === "checkbox" || type === "radio") {
        if (DECL.test(label)) {
          report.declarations.push(label.slice(0, 120));
          if (approveDeclarations && type === "checkbox" && !el.checked) { el.click(); report.filled.push(`✓ ${label.slice(0, 60)}`); }
        }
        continue;
      }
      if (el.value && el.value.trim()) continue;
      if (SKIP.test(label)) continue;
      let v = null;
      for (const [re, k] of RULES) if (re.test(label)) { v = profile[k] || null; break; }
      if (!v && /cover letter/i.test(label) && el.tagName === "TEXTAREA") v = coverLetter;
      if (!v && label.length > 12) v = answerFor(label);
      if (el.tagName === "SELECT") {
        if (v) {
          const opt = Array.from(el.options).find((o) => norm(o.text) === norm(v)) || Array.from(el.options).find((o) => norm(o.text).includes(norm(v)) || norm(v).includes(norm(o.text)) && o.text.trim());
          if (opt) { setValue(el, opt.value); report.filled.push(`${label}: ${opt.text}`); continue; }
        }
        if (required) report.missing.push(label);
        continue;
      }
      if (v) { setValue(el, v); report.filled.push(`${label.slice(0, 50)}: ${v.slice(0, 40)}${v.length > 40 ? "…" : ""}`); }
      else if (required) report.missing.push(label || "(unlabelled field)");
    } catch (e) {
      if (required) report.missing.push(label);
    }
  }
  const submit = document.querySelector('button[type="submit"], input[type="submit"]') || Array.from(document.querySelectorAll("button")).find((b) => /submit|apply/i.test(b.innerText));
  if (submit) { submit.style.outline = "3px solid #e3a33a"; submit.scrollIntoView({ block: "center", behavior: "smooth" }); }
  report.captcha = !!document.querySelector(".g-recaptcha, .h-captcha, .cf-turnstile, iframe[src*='recaptcha'], iframe[src*='hcaptcha']");
  return report;
}

/** Look for an application-confirmation message on the page. */
function jpDetectConfirmation() {
  const t = document.body ? document.body.innerText : "";
  const m = /(thank you for (applying|your application)|application (has been )?(received|submitted)|we('ve| have) received your application|successfully (submitted|applied)|your application was submitted|application sent)/i.exec(t);
  return m ? { url: location.href, text: t.slice(Math.max(0, m.index - 60), m.index + 200) } : null;
}
