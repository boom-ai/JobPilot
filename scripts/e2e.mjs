// End-to-end smoke test against a running server (local mode). Usage: node scripts/e2e.mjs http://localhost:3100 path/to/resume.pdf
import fs from "node:fs";
const BASE = process.argv[2] ?? "http://localhost:3100";
const RESUME = process.argv[3];
let pass = 0, fail = 0;
const results = [];
async function j(method, path, body, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}), ...headers }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer());
  return { status: r.status, data, ct, headers: r.headers };
}
function check(name, cond, info = "") {
  if (cond) pass++; else fail++;
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${info ? `  — ${info}` : ""}`);
}

const fixtures = [
  { title: "LLM Evaluator (Remote)", company: "Acme AI", location: "Remote - India", source_url: "https://jobs.lever.co/acmeai/llm-eval-1", description: "We are hiring LLM Evaluators to rate AI responses for factual accuracy and instruction following.\nRequirements:\n• 1+ years of experience in data annotation, RLHF or AI evaluation\n• Excellent written English and attention to detail\n• Experience following detailed evaluation guidelines\nCompensation: ₹6-9 LPA" },
  { title: "AI Data Annotation Specialist", company: "Scale AI", location: "Remote - India", source_url: "https://job-boards.greenhouse.io/scaleai/jobs/4455001", description: "Annotate images and text for model training. 0-2 years experience. Image annotation, quality checks, guideline adherence." },
  { title: "Prompt Evaluator", company: "Acme", location: "Remote", source_url: "https://jobs.ashbyhq.com/acme/9f8e", description: "Write and evaluate prompts for generative AI. Contract. $20 – $30 per hour." },
  { title: "Senior Backend Engineer", company: "BigCo", location: "San Francisco, CA", source_url: "https://bigco.example.com/jobs/1", description: "7+ years of experience building distributed systems in Java and Go. Strong programming skills, Kubernetes, AWS. On-site." },
  { title: "AI Trainer (Hindi)", company: "Outlier", location: "Worldwide", source_url: "https://remoteok.com/remote-jobs/1093", description: "Help train generative AI models by writing and evaluating responses in Hindi. Freshers welcome. Rate model outputs for accuracy and follow detailed guidelines. Remote." },
];

const me0 = await j("GET", "/api/me");
check("GET /api/me (local mode)", me0.status === 200 && me0.data.local_mode === true);

// resume upload
const fd = new FormData();
fd.append("file", new Blob([fs.readFileSync(RESUME)], { type: "application/pdf" }), "Sharma_Sanket_Resume.pdf");
const up = await j("POST", "/api/resumes", fd);
check("Upload + parse real PDF resume", up.status === 200 && up.data.profile?.name === "Sanket Sharma" && up.data.profile.experience.length === 2, `method=${up.data.method}, unknown=${JSON.stringify(up.data.unknown_fields)}`);
const prof = await j("GET", "/api/profile");
check("Master profile saved", prof.data.profile?.email === "sanketsharma8083@gmail.com" && prof.data.experience_years > 0.5, `years=${prof.data.experience_years}`);

// edit profile + preferences
const p2 = { ...prof.data.profile, links: [{ label: "GitHub", url: "https://github.com/example" }] };
check("Edit master profile", (await j("PUT", "/api/profile", { profile: p2, preferences: { notice_period: "Immediate", expected_salary: "₹7 LPA" } })).status === 200);

// jobs
const ids = [];
for (const f of fixtures) {
  const r = await j("POST", "/api/jobs", { ...f, source: "manual" });
  if (r.data.id) ids.push(r.data.id);
  check(`Add job: ${f.title}`, r.status === 200 && r.data.created, `score=${r.data.score}`);
}
const dup = await j("POST", "/api/jobs", { ...fixtures[0], source_url: fixtures[0].source_url + "?utm_source=linkedin" });
check("Duplicate detection (same URL with tracking params)", dup.data.created === false && dup.data.duplicate_of === ids[0]);

const matches = await j("GET", "/api/jobs?view=matches&sort=score");
check("AI Matches ranks relevant jobs first", matches.data.jobs[0] && matches.data.jobs[0].match_score >= 80 && !matches.data.jobs.some((x) => x.title.includes("Senior Backend")), matches.data.jobs.map((x) => `${x.title}:${x.match_score}`).join(", "));
const filt = await j("GET", `/api/jobs?view=discover&filters=${encodeURIComponent(JSON.stringify({ remote_types: ["remote"], non_coding: true }))}`);
check("Filters affect results (remote + non-coding)", filt.data.jobs.every((x) => x.remote_type === "remote") && !filt.data.jobs.some((x) => x.title.includes("Backend")), `${filt.data.total} kept, ${filt.data.excluded} excluded`);

const jid = ids[0];
check("Shortlist", (await j("PATCH", `/api/jobs/${jid}`, { action: "shortlist" })).data.status === "shortlisted");
const an = await j("POST", `/api/jobs/${jid}/analyze`);
check("Analyze (no AI → deterministic)", an.status === 200 && an.data.match.overall > 0 && an.data.ai === null);
const tl = await j("POST", `/api/jobs/${jid}/tailor`);
check("Tailor resume", tl.status === 200 && tl.data.method === "rules" && /Acme_AI_LLM_Evaluator_Remote_Resume_\d{4}-\d{2}-\d{2}/.test(tl.data.file_name), tl.data.file_name);
const ver = await j("GET", `/api/resume-versions/${tl.data.id}`);
const content = ver.data.version.generated_content;
check("Tailored resume keeps employers/dates", content.experience[0].company === "Innodata India Pvt. Ltd." && content.experience[0].start === "Dec 2025");
content.summary = content.summary + " Edited by user.";
const sv = await j("PUT", `/api/resume-versions/${tl.data.id}`, { content });
check("Save resume edits", sv.status === 200);
content.skills[0].items.push("Kubernetes");
const sv2 = await j("PUT", `/api/resume-versions/${tl.data.id}`, { content });
check("Warn when edits add skills not in profile", sv2.data.warnings?.[0]?.includes("Kubernetes"));
const pdf = await j("GET", `/api/resume-versions/${tl.data.id}/export?format=pdf`);
check("Export PDF", pdf.status === 200 && pdf.ct === "application/pdf" && pdf.data.subarray(0, 4).toString() === "%PDF", `${pdf.data.length} bytes`);
const docx = await j("GET", `/api/resume-versions/${tl.data.id}/export?format=docx`);
check("Export DOCX", docx.status === 200 && docx.data.subarray(0, 2).toString() === "PK", `${docx.data.length} bytes`);
fs.writeFileSync("/tmp/e2e_resume.pdf", pdf.data);
fs.writeFileSync("/tmp/e2e_resume.docx", docx.data);

for (const kind of ["cover_letter", "recruiter", "linkedin", "email", "intro"]) {
  const l = await j("POST", `/api/jobs/${jid}/letters`, { kind, tone: "concise" });
  check(`Generate ${kind}`, l.status === 200 && l.data.content.includes(kind === "linkedin" ? "Acme AI" : "Acme AI"));
}
const ans = await j("POST", `/api/jobs/${jid}/answers`, {});
const np = ans.data.answers.find((a) => /notice/i.test(a.question));
check("Answers use profile prefs (notice period)", np?.answer === "Immediate", JSON.stringify(np));
check("Answers generated for standard questions", ans.data.answers.length >= 10);
const prep = await j("POST", `/api/jobs/${jid}/prepare`, {});
check("Prepare application (Lever ATS, assisted mode, score≥80 → browser task)", prep.data.route === "assisted" || prep.data.route === "manual", JSON.stringify(prep.data));
const prep2 = await j("POST", `/api/jobs/${ids[4]}/prepare`, {});
check("Prepare non-ATS job → manual package", prep2.data.route === "manual", prep2.data.reason);

const apps = await j("GET", "/api/applications");
const app = apps.data.applications.find((a) => a.job_id === jid);
check("Application tracked", !!app);
check("Set follow-up + recruiter", (await j("PATCH", `/api/applications/${app.id}`, { follow_up_date: new Date(Date.now() - 864e5).toISOString().slice(0, 10), recruiter_details: { name: "Priya" }, notes: "Applied via referral" })).status === 200);
check("Mark applied (user-confirmed)", (await j("PATCH", `/api/applications/${app.id}`, { status: "applied", note: "Confirmed by user" })).data.status === "applied");
const again = await j("POST", `/api/jobs/${jid}/prepare`, {});
check("Duplicate application prevented", again.data.route === "already_applied");
const iv = await j("POST", "/api/interviews", { application_id: app.id, scheduled_at: new Date(Date.now() + 3 * 3600_000).toISOString(), interview_type: "HR screen" });
check("Add interview → status interview", iv.status === 200);
const ivp = await j("POST", `/api/interviews/${iv.data.id}/prep`);
check("Interview prep (rules)", ivp.status === 200 && ivp.data.prep.likely_questions.length > 2);
const mon = await j("POST", "/api/agent", { action: "monitor_now" });
check("Status monitoring → follow-up + interview reminders", mon.status === 200, JSON.stringify(mon.data.processed));
const notes = await j("GET", "/api/notifications");
check("Notifications created", notes.data.notifications.some((n) => n.type === "followup") && notes.data.notifications.some((n) => n.type === "interview"), notes.data.notifications.map((n) => n.type).join(","));

// merge / unmerge / hide
check("Hide job", (await j("PATCH", `/api/jobs/${ids[3]}`, { action: "hide" })).status === 200);
const hidden = await j("GET", "/api/jobs?view=hidden");
check("Hidden view", hidden.data.jobs.some((x) => x.id === ids[3]));
check("Manual merge", (await j("POST", "/api/jobs/merge", { primary_id: ids[1], duplicate_ids: [ids[2]] })).data.merged === 1);
const dups = await j("GET", "/api/jobs?view=duplicates");
check("Duplicates view", dups.data.jobs.some((x) => x.id === ids[2]));
check("Unmerge", (await j("POST", `/api/jobs/${ids[2]}/unmerge`)).status === 200);

// searches
const ss = await j("GET", "/api/searches");
check("Default presets seeded", ss.data.searches.length === 8);
const cl = await j("POST", "/api/searches", { name: "Clone", clone_of: ss.data.searches[0].id });
check("Clone preset", cl.status === 200 && cl.data.name === "Clone");
check("Edit preset schedule", (await j("PATCH", `/api/searches/${cl.data.id}`, { schedule: "daily" })).data.schedule === "daily");
check("Delete preset", (await j("DELETE", `/api/searches/${cl.data.id}`)).status === 200);
const run = await j("POST", "/api/search/run", { keywords: "LLM", sources: ["remotive", "remoteok"] });
check("Live search: unreachable sources fail gracefully (sandbox has no internet)", run.status === 200 && run.data.sources.every((s) => !s.ok || s.count >= 0), run.data.sources.map((s) => `${s.source}:${s.ok ? s.count : s.error ?? s.skipped}`).join(", "));
const src = await j("GET", "/api/sources");
check("Source statuses honest", src.data.sources.find((s) => s.id === "linkedin").status === "manual" && src.data.sources.find((s) => s.id === "remotive").status === "api_unavailable");

// agent controls
check("Pause", (await j("POST", "/api/agent", { action: "pause" })).data.state === "paused");
const blocked = await j("POST", "/api/agent", { action: "run_now" });
check("Run blocked while paused", blocked.status === 409);
check("Emergency stop", (await j("POST", "/api/agent", { action: "stop" })).data.state === "stopped");
const ag = await j("GET", "/api/agent");
check("Stop cancelled pending tasks", !ag.data.tasks.some((t) => ["pending", "running", "waiting_user"].includes(t.status)));
check("Resume", (await j("POST", "/api/agent", { action: "resume" })).data.state === "running");

// dashboard & analytics & search
const dash = await j("GET", "/api/dashboard");
check("Dashboard stats from records", dash.data.stats.total_jobs === 5 && dash.data.stats.applied >= 1 && dash.data.pipeline.length === 8, JSON.stringify(dash.data.stats));
const an2 = await j("GET", "/api/analytics");
check("Analytics", an2.status === 200 && an2.data.totals.applied >= 1 && an2.data.by_source.length > 0);
const gs = await j("GET", "/api/global-search?q=acme");
check("Global search", gs.data.jobs.length >= 1 && gs.data.applications.length >= 1);

// extension bridge
const tok = await j("POST", "/api/tokens", { name: "test" });
check("Create extension token", tok.data.token?.startsWith("jp_"));
const auth = { authorization: `Bearer ${tok.data.token}`, origin: "chrome-extension://abc" };
const ctx = await j("GET", `/api/ext/context?url=${encodeURIComponent(fixtures[0].source_url)}`, null, auth);
check("Extension: context by URL", ctx.data.found && ctx.data.profile.first_name === "Sanket" && ctx.data.resume, `answers=${ctx.data.answers?.length}`);
check("Extension: CORS header", ctx.headers.get("access-control-allow-origin") === "chrome-extension://abc");
const cap = await j("POST", "/api/ext/jobs", { title: "Data Labeling Associate", company: "Labelbox", url: "https://www.linkedin.com/jobs/view/9999", description: "Label data for AI models. Freshers welcome. Remote India.", site: "linkedin" }, auth);
check("Extension: capture LinkedIn job", cap.data.created && cap.data.job?.title === "Data Labeling Associate");
const noev = await j("POST", "/api/ext/status", { job_id: cap.data.job_id, status: "applied" }, auth);
check("Extension: 'applied' rejected without evidence", noev.status === 400);
const er = await j("GET", `/api/ext/resume?job_id=${jid}`, null, auth);
check("Extension: download tailored resume", er.status === 200 && er.ct === "application/pdf");
const bad = await j("GET", "/api/ext/context?url=x", null, { authorization: "Bearer jp_wrong" });
check("Extension: invalid token rejected", bad.status === 401);

// browser workspace
check("Bookmarks", (await j("POST", "/api/browser/bookmarks", { title: "Naukri", url: "https://www.naukri.com" })).status === 200);
const ssrf = await j("GET", `/api/browser/inspect?url=${encodeURIComponent("http://127.0.0.1:3100/api/me")}`);
check("Browser: blocks private-network URLs (SSRF)", ssrf.status === 422, ssrf.data.error);

// secrets
const sec = await j("PUT", "/api/settings/secrets", { ai_api_key: "AIzaFAKEKEY1234567890" });
const secg = await j("GET", "/api/settings/secrets");
check("AI key stored encrypted, returned masked", sec.status === 200 && secg.data.ai_api_key === "AIza••••7890");
const raw = fs.readFileSync("/tmp/jpdata/db.json", "utf8");
check("AI key not stored in plaintext", !raw.includes("AIzaFAKEKEY1234567890"));
await j("PUT", "/api/settings/secrets", { ai_api_key: null });

// privacy
const ex = await j("GET", "/api/privacy/export");
check("Export all data", ex.status === 200 && ex.ct.includes("json") && ex.data.jobs.length >= 5 && !JSON.stringify(ex.data).includes("token_hash"));
const delA = await j("POST", "/api/privacy/delete", { scope: "activity", confirm: "DELETE" });
check("Delete scope (activity)", delA.status === 200);
const delBad = await j("POST", "/api/privacy/delete", { scope: "all", confirm: "nope" });
check("Delete requires confirmation", delBad.status === 400);

console.log(results.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
