/* global chrome, jpExtractJob, jpFillForm, jpDetectConfirmation */
const $ = (id) => document.getElementById(id);
let cfg = { appUrl: "", token: "" };
let tab = null;
let page = null; // extracted job info
let ctx = null; // context from app

async function loadCfg() {
  cfg = await chrome.storage.local.get({ appUrl: "", token: "" });
}

async function api(path, opts = {}) {
  const res = await fetch(cfg.appUrl.replace(/\/$/, "") + path, {
    ...opts,
    headers: { authorization: `Bearer ${cfg.token}`, ...(opts.json ? { "content-type": "application/json" } : {}), ...(opts.headers || {}) },
    body: opts.json ? JSON.stringify(opts.json) : opts.body,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch (e) {}
    throw new Error(msg);
  }
  return opts.raw ? res : res.json();
}

function show(view) {
  $("view-settings").hidden = view !== "settings";
  $("view-main").hidden = view !== "main";
}

function setStatus(text, cls = "muted") {
  $("status").className = cls;
  $("status").textContent = text;
}

async function run(fn, btn) {
  const label = btn ? btn.textContent : "";
  try {
    if (btn) { btn.disabled = true; btn.textContent = "…"; }
    await fn();
  } catch (e) {
    setStatus(e.message, "err");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

function render() {
  const job = (ctx && ctx.job) || null;
  $("job").hidden = !(job || (page && page.title));
  $("job-title").textContent = job ? job.title : page ? page.title : "";
  $("job-company").textContent = job ? `${job.company}${job.location ? " · " + job.location : ""}` : page ? page.company : "";
  $("score").textContent = job && job.match_score != null ? job.match_score : "–";
  $("score").style.borderColor = job && job.match_score >= 90 ? "var(--ok)" : job && job.match_score >= 80 ? "#6ea3f2" : job && job.match_score >= 65 ? "var(--warn)" : "var(--line)";
  const badges = [];
  if (ctx && ctx.application) badges.push(ctx.application.application_status.replace(/_/g, " "));
  if (job && job.match_analysis) badges.push(job.match_analysis.recommendation + " match");
  if (ctx && ctx.resume) badges.push("resume ready");
  $("badges").innerHTML = badges.map((b) => `<span class="badge">${b}</span>`).join("");
  $("btn-save-job").textContent = job ? "Saved ✓" : "Save Job";
  $("btn-save-job").disabled = !!job || !page || !page.title;
  for (const id of ["btn-analyze", "btn-tailor", "btn-prepare"]) $(id).disabled = !job;
  $("apply").hidden = !job;
  $("docs").hidden = !job;
  if (job) {
    const parts = [];
    if (ctx.resume) parts.push(`<div class="doc"><b>Tailored resume</b><a href="#" id="dl-resume">${ctx.resume.file_name}.pdf ↓</a></div>`);
    if (ctx.cover_letter) parts.push(`<div class="doc"><b>Cover letter <a href="#" data-copy="cl">copy</a></b><p>${escapeHtml(ctx.cover_letter)}</p></div>`);
    (ctx.answers || []).forEach((a, i) => parts.push(`<div class="doc"><b>${escapeHtml(a.question)} <a href="#" data-copy="a${i}">copy</a>${a.approved ? "" : " · <span class='err'>not approved</span>"}</b><p>${escapeHtml(a.answer)}</p></div>`));
    $("docs-body").innerHTML = parts.join("") || "<p class='muted'>Nothing prepared yet — use Tailor Resume / Prepare Application.</p>";
    document.querySelectorAll("[data-copy]").forEach((el) =>
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const k = el.getAttribute("data-copy");
        const text = k === "cl" ? ctx.cover_letter : ctx.answers[Number(k.slice(1))].answer;
        navigator.clipboard.writeText(text);
        el.textContent = "copied";
      }),
    );
    const dl = $("dl-resume");
    if (dl) dl.addEventListener("click", (e) => { e.preventDefault(); downloadResume(); });
  }
  $("open-app").href = job ? `${cfg.appUrl.replace(/\/$/, "")}/jobs/${job.id}` : cfg.appUrl;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

async function downloadResume() {
  const res = await api(`/api/ext/resume?job_id=${ctx.job.id}`, { raw: true });
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${ctx.resume.file_name}.pdf`;
  a.click();
}

async function exec(func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
  return r ? r.result : null;
}

async function init() {
  await loadCfg();
  if (!cfg.appUrl || !cfg.token) {
    $("app-url").value = cfg.appUrl;
    show("settings");
    return;
  }
  show("main");
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || "")) {
    setStatus("Open a job posting or application page to use Job Pilot.");
    return;
  }
  try {
    page = await exec(jpExtractJob);
  } catch (e) {
    page = null;
  }
  try {
    ctx = await api(`/api/ext/context?url=${encodeURIComponent(tab.url)}`);
    if (!ctx.found) ctx = null;
  } catch (e) {
    setStatus(`Can't reach Job Pilot: ${e.message}`, "err");
    return;
  }
  setStatus(ctx ? "This job is in Job Pilot." : page && page.is_job ? "Job detected on this page." : "No job detected — you can still save this page.");
  render();
  if (ctx) {
    const conf = await exec(jpDetectConfirmation).catch(() => null);
    const applied = ctx.application && ["applied", "application_confirmed", "interview", "offer"].includes(ctx.application.application_status);
    if (conf && !applied) {
      $("confirm-detected").hidden = false;
      $("btn-record-confirm").onclick = () => run(async () => {
        await api("/api/ext/status", { method: "POST", json: { job_id: ctx.job.id, status: "applied", evidence: { kind: "confirmation_page", url: conf.url, text: conf.text } } });
        $("confirm-detected").hidden = true;
        await refresh();
        setStatus("Recorded as applied.", "okc");
      });
    }
  }
}

async function refresh() {
  ctx = await api(`/api/ext/context?url=${encodeURIComponent(tab.url)}`);
  if (!ctx.found) ctx = null;
  render();
}

$("btn-settings").onclick = async () => {
  await loadCfg();
  $("app-url").value = cfg.appUrl;
  $("token").value = "";
  show("settings");
};

$("btn-save").onclick = () => run(async () => {
  const appUrl = $("app-url").value.trim().replace(/\/$/, "");
  const token = $("token").value.trim() || cfg.token;
  if (!/^https?:\/\//.test(appUrl)) throw new Error("Enter the full app URL, e.g. https://your-app.vercel.app");
  const origin = new URL(appUrl).origin + "/*";
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) throw new Error("Permission to reach the app was not granted.");
  cfg = { appUrl, token };
  await api("/api/ext/context?url=" + encodeURIComponent(appUrl)); // validates token
  await chrome.storage.local.set(cfg);
  $("settings-msg").textContent = "Connected ✓";
  setTimeout(init, 400);
}, $("btn-save"));

$("btn-save-job").onclick = () => run(async () => {
  if (!page || !page.title) throw new Error("Couldn't read job details on this page.");
  if (!page.company) {
    const c = prompt("Company name for this job?");
    if (!c) return;
    page.company = c;
  }
  const r = await api("/api/ext/jobs", { method: "POST", json: page });
  ctx = { ...r, found: true };
  render();
  setStatus(r.created ? `Saved — match ${r.job.match_score ?? "pending"}.` : "Already in Job Pilot.", "okc");
}, $("btn-save-job"));

const action = (name, msg) => () => run(async () => {
  ctx = { ...(await api("/api/ext/action", { method: "POST", json: { job_id: ctx.job.id, action: name } })), found: true };
  render();
  setStatus(msg, "okc");
}, $(`btn-${name}`));
$("btn-analyze").onclick = action("analyze", "Analysis updated.");
$("btn-tailor").onclick = action("tailor", "Tailored resume created.");
$("btn-prepare").onclick = action("prepare", "Application package ready.");

$("btn-fill").onclick = () => run(async () => {
  if (!ctx.resume) {
    ctx = { ...(await api("/api/ext/action", { method: "POST", json: { job_id: ctx.job.id, action: "prepare" } })), found: true };
    render();
  }
  let resume = null;
  if (ctx.resume) {
    const res = await api(`/api/ext/resume?job_id=${ctx.job.id}`, { raw: true });
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    resume = { name: `${ctx.resume.file_name}.pdf`, base64: btoa(bin) };
  }
  const approved = (ctx.answers || []).filter((a) => a.approved || !(a.flags || []).length);
  const report = await exec(jpFillForm, [{ profile: ctx.profile, answers: [...approved, ...(ctx.library || [])], coverLetter: ctx.cover_letter, resume, approveDeclarations: false }]);
  const lines = [];
  lines.push(`<p class="okc">Filled ${report.filled.length} field(s)${report.uploaded ? " and attached your resume" : ""}.</p>`);
  if (report.missing.length) lines.push(`<p class="err">Needs you: ${report.missing.map(escapeHtml).join(", ")}</p>`);
  if (report.declarations.length) lines.push(`<p>Declarations left for you to review and tick: ${report.declarations.map(escapeHtml).join("; ")}</p>`);
  if (report.captcha) lines.push(`<p>This form has a CAPTCHA — solve it yourself before submitting.</p>`);
  lines.push(`<p class="muted">Review the highlighted fields, then click the outlined Submit button yourself.</p>`);
  $("fill-report").innerHTML = lines.join("");
}, $("btn-fill"));

$("chk-submitted").onchange = (e) => ($("btn-mark-applied").disabled = !e.target.checked);
$("btn-mark-applied").onclick = () => run(async () => {
  await api("/api/ext/status", { method: "POST", json: { job_id: ctx.job.id, status: "applied", evidence: { kind: "user_confirmed", url: tab.url } } });
  $("chk-submitted").checked = false;
  $("btn-mark-applied").disabled = true;
  await refresh();
  setStatus("Recorded as applied.", "okc");
}, $("btn-mark-applied"));

init();
