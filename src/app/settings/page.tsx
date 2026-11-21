"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Copy, Download, Key, Plus, Save, Trash2 } from "lucide-react";
import type { AppSettings, JobPreferences, JobType, RemoteType } from "@/lib/types";
import { api, del, downloadFile, patch, post, put, timeAgo, useApi } from "@/lib/client";
import { Badge, Button, Checkbox, ErrorNote, Field, Input, Loading, Modal, PageHeader, Panel, Select, Switch, TagInput, Textarea, cn, useAction, useToast } from "@/components/ui";
import { StatusPill } from "@/components/job-browser";
import { useMe } from "@/components/shell";

type Tab = "preferences" | "ai" | "scoring" | "automation" | "sources" | "notifications" | "answers" | "extension" | "privacy";
const TABS: { v: Tab; l: string }[] = [
  { v: "preferences", l: "Job preferences" },
  { v: "ai", l: "AI" },
  { v: "scoring", l: "Scoring" },
  { v: "automation", l: "Automation" },
  { v: "sources", l: "Sources" },
  { v: "notifications", l: "Notifications" },
  { v: "answers", l: "Answer library" },
  { v: "extension", l: "Chrome extension" },
  { v: "privacy", l: "Privacy & data" },
];

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Settings />
    </Suspense>
  );
}

function Settings() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = (sp.get("tab") as Tab) ?? "preferences";
  const { data, error, loading, reload } = useApi<{ preferences: JobPreferences; settings: AppSettings }>("/api/profile");
  const [prefs, setPrefs] = useState<JobPreferences | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const { busy, run } = useAction();
  const { refresh } = useMe();
  useEffect(() => {
    if (data) {
      setPrefs(data.preferences);
      setSettings(data.settings);
    }
  }, [data]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!prefs || !settings || !data) return null;
  const dirty = JSON.stringify(prefs) !== JSON.stringify(data.preferences) || JSON.stringify(settings) !== JSON.stringify(data.settings);
  const save = () => run("save", () => put("/api/profile", { preferences: prefs, settings }), "Settings saved").then(() => { reload(); refresh(); });
  const S = <K extends keyof AppSettings>(k: K, v: Partial<AppSettings[K]>) => setSettings({ ...settings, [k]: { ...(settings[k] as object), ...v } });
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" actions={<Button variant="primary" icon={<Save className="size-3.5" />} disabled={!dirty} loading={busy === "save"} onClick={save}>Save changes</Button>} />
      <div className="flex gap-6">
        <nav className="w-48 shrink-0 space-y-0.5">
          {TABS.map((t) => (
            <button key={t.v} onClick={() => router.replace(`/settings?tab=${t.v}`)} className={cn("block w-full rounded-md px-2.5 py-1.5 text-left text-[13px]", tab === t.v ? "bg-subtle font-medium" : "text-muted hover:bg-subtle hover:text-fg")}>{t.l}</button>
          ))}
        </nav>
        <div className="min-w-0 max-w-3xl flex-1 space-y-4">
          {tab === "preferences" && <Preferences p={prefs} set={setPrefs} appName={settings.app_name} setAppName={(v) => setSettings({ ...settings, app_name: v })} />}
          {tab === "ai" && <AISettings s={settings} S={S} />}
          {tab === "scoring" && <Scoring s={settings} S={S} />}
          {tab === "automation" && <Automation s={settings} S={S} />}
          {tab === "sources" && <Sources s={settings} S={S} />}
          {tab === "notifications" && <Notifs s={settings} S={S} />}
          {tab === "answers" && <AnswerLibrary />}
          {tab === "extension" && <Extension />}
          {tab === "privacy" && <Privacy />}
        </div>
      </div>
    </div>
  );
}

const REMOTES: RemoteType[] = ["remote", "hybrid", "onsite"];
const JTYPES: JobType[] = ["full-time", "part-time", "contract", "freelance", "internship", "temporary"];

function Preferences({ p, set, appName, setAppName }: { p: JobPreferences; set: (p: JobPreferences) => void; appName: string; setAppName: (v: string) => void }) {
  const u = (x: Partial<JobPreferences>) => set({ ...p, ...x });
  return (
    <>
      <Panel title="Target roles">
        <div className="space-y-3">
          <Field label="Roles" hint="Used for searching and title matching. Similar roles are matched via role families (e.g. Rater ≈ Evaluator)."><TagInput value={p.roles} onChange={(v) => u({ roles: v })} /></Field>
          <Field label="Keywords"><TagInput value={p.keywords} onChange={(v) => u({ keywords: v })} /></Field>
          <Field label="Exclude keywords (title)"><TagInput value={p.exclude_keywords} onChange={(v) => u({ exclude_keywords: v })} /></Field>
          <Field label="Exclude companies"><TagInput value={p.exclude_companies} onChange={(v) => u({ exclude_companies: v })} /></Field>
        </div>
      </Panel>
      <Panel title="Location & type">
        <div className="space-y-3">
          <Field label="Locations"><TagInput value={p.locations} onChange={(v) => u({ locations: v })} /></Field>
          <div className="flex flex-wrap gap-4">{REMOTES.map((r) => <Checkbox key={r} checked={p.remote_types.includes(r)} onChange={(v) => u({ remote_types: v ? [...p.remote_types, r] : p.remote_types.filter((x) => x !== r) })} label={<span className="capitalize">{r}</span>} />)}</div>
          <div className="flex flex-wrap gap-4">{JTYPES.map((r) => <Checkbox key={r} checked={p.job_types.includes(r)} onChange={(v) => u({ job_types: v ? [...p.job_types, r] : p.job_types.filter((x) => x !== r) })} label={<span className="capitalize">{r}</span>} />)}</div>
          <Checkbox checked={p.open_to_international_remote} onChange={(v) => u({ open_to_international_remote: v })} label="Open to international remote roles" />
        </div>
      </Panel>
      <Panel title="Compensation & availability">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Minimum salary (LPA)"><Input type="number" min={0} step={0.5} value={p.min_salary_inr_lpa ?? ""} onChange={(e) => u({ min_salary_inr_lpa: e.target.value ? Number(e.target.value) : null })} /></Field>
          <Field label="Minimum salary (USD / year, international)"><Input type="number" min={0} value={p.min_salary_usd_annual ?? ""} onChange={(e) => u({ min_salary_usd_annual: e.target.value ? Number(e.target.value) : null })} /></Field>
          <Field label="Notice period" hint="Used to answer application questions. Leave empty to be flagged."><Input value={p.notice_period ?? ""} onChange={(e) => u({ notice_period: e.target.value })} placeholder="e.g. Immediate / 30 days" /></Field>
          <Field label="Expected salary (as you'd state it)"><Input value={p.expected_salary ?? ""} onChange={(e) => u({ expected_salary: e.target.value })} placeholder="e.g. ₹7 LPA" /></Field>
          <Field label="Work authorization"><Input value={p.work_authorization ?? ""} onChange={(e) => u({ work_authorization: e.target.value })} placeholder="e.g. Indian citizen; no sponsorship needed for India" /></Field>
          <Field label="Years of experience override" hint="Leave empty to compute from your profile."><Input type="number" min={0} step={0.5} value={p.experience_years ?? ""} onChange={(e) => u({ experience_years: e.target.value ? Number(e.target.value) : null })} /></Field>
        </div>
      </Panel>
      <Panel title="General">
        <Field label="Product name"><Input value={appName} onChange={(e) => setAppName(e.target.value)} /></Field>
      </Panel>
    </>
  );
}

function AISettings({ s, S }: { s: AppSettings; S: <K extends keyof AppSettings>(k: K, v: Partial<AppSettings[K]>) => void }) {
  const secrets = useApi<{ storage: boolean; ai_api_key: string | null; telegram_bot_token: string | null; env_fallback?: { gemini: boolean; openai: boolean } }>("/api/settings/secrets");
  const [key, setKey] = useState("");
  const { busy, run } = useAction();
  const { refresh } = useMe();
  const models = s.ai.provider === "openai" ? ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"] : ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"];
  return (
    <>
      <Panel title="Provider">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Provider">
            <Select value={s.ai.provider} onChange={(e) => S("ai", { provider: e.target.value as AppSettings["ai"]["provider"], model: e.target.value === "openai" ? "gpt-4o-mini" : "gemini-2.5-flash" })}>
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="none">None (rule-based only)</option>
            </Select>
          </Field>
          <Field label="Model" hint="Type any model id your key can access.">
            <Input list="models" value={s.ai.model} onChange={(e) => S("ai", { model: e.target.value })} />
            <datalist id="models">{models.map((m) => <option key={m} value={m} />)}</datalist>
          </Field>
        </div>
        <div className="mt-4 space-y-2">
          <Field label="API key" hint={<>Stored encrypted (AES-256-GCM) on the server, never sent back to the browser. {secrets.data?.env_fallback && (secrets.data.env_fallback.gemini || secrets.data.env_fallback.openai) ? "A server environment key is also configured as fallback." : ""}</>}>
            <div className="flex gap-2">
              <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={secrets.data?.ai_api_key ?? "Paste key…"} autoComplete="off" />
              <Button icon={<Key className="size-3.5" />} disabled={!key || !secrets.data?.storage} loading={busy === "k"} onClick={() => run("k", () => put("/api/settings/secrets", { ai_api_key: key }), "Key saved").then(() => { setKey(""); secrets.reload(); refresh(); })}>Save key</Button>
              {secrets.data?.ai_api_key && <Button variant="ghost" onClick={() => run("r", () => put("/api/settings/secrets", { ai_api_key: null }), "Key removed").then(() => { secrets.reload(); refresh(); })}>Remove</Button>}
            </div>
          </Field>
          {secrets.data && !secrets.data.storage && <p className="text-[12px] text-warn">Server is missing SUPABASE_SERVICE_ROLE_KEY, so keys can only be set via environment variables (GEMINI_API_KEY / OPENAI_API_KEY).</p>}
          <p className="text-[12px] text-faint">Free Gemini key: aistudio.google.com → Get API key. Without a key, scoring, tailoring, letters and answers still work using deterministic engines.</p>
        </div>
      </Panel>
      <Panel title="Behaviour">
        <div className="space-y-3">
          <Field label="Tailoring style">
            <Select value={s.ai.tailoring_tone} onChange={(e) => S("ai", { tailoring_tone: e.target.value as AppSettings["ai"]["tailoring_tone"] })}>
              <option value="concise">Concise bullets</option><option value="balanced">Balanced</option><option value="detailed">Detailed</option>
            </Select>
          </Field>
          <Switch checked={s.ai.use_ai_for_scoring_narrative} onChange={(v) => S("ai", { use_ai_for_scoring_narrative: v })} label="Run AI job analysis for new matches (Moderate and above)" />
          <Switch checked={s.ai.grounded_company_research} onChange={(v) => S("ai", { grounded_company_research: v })} label="Use Google Search grounding for company research (Gemini)" />
        </div>
      </Panel>
    </>
  );
}

const WEIGHT_LABEL: Record<string, string> = { skills: "Skills compatibility", experience: "Relevant experience", title: "Job title relevance", industry: "Industry relevance", education: "Education requirements", keywords: "Keyword alignment", location: "Location preference", remote: "Remote preference", employment_type: "Employment type", salary: "Salary preference" };

function Scoring({ s, S }: { s: AppSettings; S: <K extends keyof AppSettings>(k: K, v: Partial<AppSettings[K]>) => void }) {
  const total = Object.values(s.scoring.weights).reduce((a, b) => a + b, 0);
  const [rescoring, setRescoring] = useState(false);
  const toast = useToast();
  const rescore = async () => {
    setRescoring(true);
    try {
      const r = await api<{ jobs: { id: string }[] }>("/api/jobs?view=all&limit=200");
      for (const j of r.jobs) await post(`/api/jobs/${j.id}/analyze`);
      toast(`Re-scored ${r.jobs.length} jobs`);
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setRescoring(false);
    }
  };
  return (
    <>
      <Panel title="Factor weights" actions={<span className="text-[12px] text-muted">Total {total} (normalised)</span>}>
        <div className="space-y-2.5">
          {Object.entries(s.scoring.weights).map(([k, v]) => (
            <div key={k} className="grid grid-cols-[200px_1fr_48px] items-center gap-3">
              <span className="text-[13px]">{WEIGHT_LABEL[k]}</span>
              <input type="range" min={0} max={40} value={v} onChange={(e) => S("scoring", { weights: { ...s.scoring.weights, [k]: Number(e.target.value) } })} className="accent-[var(--accent)]" />
              <span className="text-right tabular-nums text-muted">{total ? Math.round((v / total) * 100) : 0}%</span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Recommendation thresholds">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Excellent ≥"><Input type="number" value={s.scoring.thresholds.excellent} onChange={(e) => S("scoring", { thresholds: { ...s.scoring.thresholds, excellent: Number(e.target.value) } })} /></Field>
          <Field label="Strong ≥"><Input type="number" value={s.scoring.thresholds.strong} onChange={(e) => S("scoring", { thresholds: { ...s.scoring.thresholds, strong: Number(e.target.value) } })} /></Field>
          <Field label="Moderate ≥"><Input type="number" value={s.scoring.thresholds.moderate} onChange={(e) => S("scoring", { thresholds: { ...s.scoring.thresholds, moderate: Number(e.target.value) } })} /></Field>
        </div>
        <p className="mt-2 text-[12px] text-faint">Below Moderate = Low match.</p>
      </Panel>
      <Panel title="Apply to existing jobs">
        <p className="mb-2 text-[13px] text-muted">Save your changes first, then re-score the 200 most recent jobs with the new weights.</p>
        <Button loading={rescoring} onClick={rescore}>Re-score recent jobs</Button>
      </Panel>
    </>
  );
}

function Automation({ s, S }: { s: AppSettings; S: <K extends keyof AppSettings>(k: K, v: Partial<AppSettings[K]>) => void }) {
  const a = s.automation;
  const num = (k: keyof AppSettings["automation"]) => (e: React.ChangeEvent<HTMLInputElement>) => S("automation", { [k]: Number(e.target.value) } as never);
  return (
    <>
      <Panel title="Application mode">
        <div className="space-y-2">
          {([
            ["manual", "Manual", "Job Pilot prepares the tailored resume, cover letter, answers and checklist. You apply yourself."],
            ["assisted", "Assisted", "The local browser worker opens supported forms (Greenhouse / Lever / Ashby), fills verified data, uploads documents, and waits for your approval before submitting."],
            ["auto", "Auto application", "For jobs at or above the auto-apply score on permitted ATS forms, the worker submits automatically within your limits. CAPTCHA, MFA, missing required fields or legal declarations always pause for you."],
          ] as const).map(([v, l, d]) => (
            <label key={v} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3", a.mode === v ? "border-accent bg-accent-soft/40" : "border-line")}>
              <input type="radio" name="mode" checked={a.mode === v} onChange={() => S("automation", { mode: v })} className="mt-1 accent-[var(--accent)]" />
              <span><span className="font-medium">{l}</span><span className="block text-[12.5px] text-muted">{d}</span></span>
            </label>
          ))}
        </div>
      </Panel>
      <Panel title="Thresholds">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Auto-tailor resumes at ≥"><Input type="number" value={a.auto_tailor_min_score} onChange={num("auto_tailor_min_score")} /></Field>
          <Field label="Queue for approval at ≥"><Input type="number" value={a.approval_min_score} onChange={num("approval_min_score")} /></Field>
          <Field label="Eligible for auto-apply at ≥"><Input type="number" value={a.auto_apply_min_score} onChange={num("auto_apply_min_score")} /></Field>
        </div>
        <p className="mt-2 text-[12px] text-faint">Jobs below the approval threshold are never applied to automatically.</p>
      </Panel>
      <Panel title="Limits">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Per day"><Input type="number" min={0} value={a.daily_limit} onChange={num("daily_limit")} /></Field>
          <Field label="Per week"><Input type="number" min={0} value={a.weekly_limit} onChange={num("weekly_limit")} /></Field>
          <Field label="Per company / week"><Input type="number" min={0} value={a.per_company_limit} onChange={num("per_company_limit")} /></Field>
          <Field label="Per source / day"><Input type="number" min={0} value={a.per_source_daily_limit} onChange={num("per_source_daily_limit")} /></Field>
        </div>
      </Panel>
      <Panel title="Safety">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4">
            {["greenhouse", "lever", "ashby"].map((x) => <Checkbox key={x} checked={a.allowed_auto_sources.includes(x)} onChange={(v) => S("automation", { allowed_auto_sources: v ? [...a.allowed_auto_sources, x] : a.allowed_auto_sources.filter((y) => y !== x) })} label={<span className="capitalize">Allow {x} forms</span>} />)}
          </div>
          <Switch checked={a.auto_search} onChange={(v) => S("automation", { auto_search: v })} label="Run scheduled searches automatically" />
          <Switch checked={a.approve_declarations} onChange={(v) => S("automation", { approve_declarations: v })} label="Pre-approve standard legal declarations (e.g. “I certify the information is accurate”)" />
          <Field label="Wait for you to solve a CAPTCHA (minutes)" hint="The worker pauses, notifies you, and never attempts to solve it."><Input type="number" min={1} max={60} value={a.captcha_wait_minutes} onChange={num("captcha_wait_minutes")} className="w-32" /></Field>
        </div>
      </Panel>
    </>
  );
}

function Sources({ s, S }: { s: AppSettings; S: <K extends keyof AppSettings>(k: K, v: Partial<AppSettings[K]>) => void }) {
  const { data } = useApi<{ sources: { id: string; name: string; kind: string; status: string; notes: string; homepage: string; last_result: { ok: boolean; count: number; error?: string } | null; last_checked: string | null }[] }>("/api/sources");
  return (
    <>
      <Panel title="Sources" bodyClass="p-0">
        <ul className="divide-y divide-line">
          {(data?.sources ?? []).map((x) => (
            <li key={x.id} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium">{x.name} <StatusPill status={x.status} /> <Badge>{x.kind}</Badge></div>
                <p className="text-[12px] text-muted">{x.notes}</p>
                {x.last_result && <p className="text-[11.5px] text-faint">Last run {timeAgo(x.last_checked)}: {x.last_result.ok ? `${x.last_result.count} jobs` : x.last_result.error}</p>}
              </div>
              {x.kind !== "manual" && <Switch checked={s.sources.enabled.includes(x.id)} onChange={(v) => S("sources", { enabled: v ? [...s.sources.enabled, x.id] : s.sources.enabled.filter((y) => y !== x.id) })} />}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Company career boards (public ATS APIs)">
        <div className="space-y-3">
          <Field label="Greenhouse board tokens" hint="From boards.greenhouse.io/<token> or job-boards.greenhouse.io/<token>"><TagInput value={s.sources.greenhouse_boards} onChange={(v) => S("sources", { greenhouse_boards: v })} /></Field>
          <Field label="Lever company slugs" hint="From jobs.lever.co/<slug>"><TagInput value={s.sources.lever_companies} onChange={(v) => S("sources", { lever_companies: v })} /></Field>
          <Field label="Ashby board names" hint="From jobs.ashbyhq.com/<name>"><TagInput value={s.sources.ashby_boards} onChange={(v) => S("sources", { ashby_boards: v })} /></Field>
          <Field label="Workday career site URLs" hint="e.g. https://company.wd5.myworkdayjobs.com/en-US/External"><TagInput value={s.sources.workday_sites} onChange={(v) => S("sources", { workday_sites: v })} /></Field>
          <Field label="USD → INR exchange rate" hint="Optional. Enables salary comparison and filters across currencies."><Input type="number" step={0.01} value={s.sources.exchange_rate_usd_inr ?? ""} onChange={(e) => S("sources", { exchange_rate_usd_inr: e.target.value ? Number(e.target.value) : null })} className="w-40" /></Field>
        </div>
      </Panel>
    </>
  );
}

const NOTIF_LABEL: Record<string, string> = { high_match: "New high-match jobs", saved_search: "Saved-search matches", application: "Application updates", failure: "Application failures", recruiter: "Recruiter responses", interview: "Interviews & assessments", followup: "Follow-up reminders", resume: "Resume generated", agent_error: "Agent errors" };

function Notifs({ s, S }: { s: AppSettings; S: <K extends keyof AppSettings>(k: K, v: Partial<AppSettings[K]>) => void }) {
  const secrets = useApi<{ storage: boolean; telegram_bot_token: string | null }>("/api/settings/secrets");
  const [tok, setTok] = useState("");
  const { busy, run } = useAction();
  const n = s.notifications;
  return (
    <>
      <Panel title="In-app">
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.keys(NOTIF_LABEL).map((k) => <Switch key={k} checked={n.in_app[k] !== false} onChange={(v) => S("notifications", { in_app: { ...n.in_app, [k]: v } })} label={NOTIF_LABEL[k]} />)}
        </div>
        <Field label="High-match threshold" className="mt-3 w-40"><Input type="number" value={n.high_match_threshold} onChange={(e) => S("notifications", { high_match_threshold: Number(e.target.value) })} /></Field>
      </Panel>
      <Panel title="Telegram (optional)">
        <div className="space-y-3">
          <Field label="Bot token" hint="Create a bot with @BotFather. Stored encrypted.">
            <div className="flex gap-2">
              <Input type="password" value={tok} onChange={(e) => setTok(e.target.value)} placeholder={secrets.data?.telegram_bot_token ?? "123456:ABC…"} />
              <Button disabled={!tok} loading={busy === "t"} onClick={() => run("t", () => put("/api/settings/secrets", { telegram_bot_token: tok }), "Saved").then(() => { setTok(""); secrets.reload(); })}>Save</Button>
            </div>
          </Field>
          <Field label="Chat ID" hint="Message your bot, then open api.telegram.org/bot<token>/getUpdates to find your chat id."><Input value={n.telegram_chat_id ?? ""} onChange={(e) => S("notifications", { telegram_chat_id: e.target.value })} /></Field>
        </div>
      </Panel>
      <Panel title="Discord (optional)">
        <Field label="Webhook URL"><Input value={n.discord_webhook_url ?? ""} onChange={(e) => S("notifications", { discord_webhook_url: e.target.value })} placeholder="https://discord.com/api/webhooks/…" /></Field>
      </Panel>
    </>
  );
}

function AnswerLibrary() {
  const { data, reload } = useApi<{ items: { id: string; key: string; question: string; answer: string; category: string; verified: boolean }[] }>("/api/answer-library");
  const { run } = useAction();
  const [newQ, setNewQ] = useState("");
  return (
    <Panel title="Reusable verified answers" actions={<span className="text-[12px] text-muted">Used first when answering application questions</span>}>
      <div className="space-y-3">
        {(data?.items ?? []).map((it) => <LibRow key={it.id} it={it} reload={reload} />)}
        <form className="flex gap-2 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); if (newQ.trim()) run("n", () => post("/api/answer-library", { question: newQ, answer: "", verified: false }), "Added").then(() => { setNewQ(""); reload(); }); }}>
          <Input value={newQ} onChange={(e) => setNewQ(e.target.value)} placeholder="Add a question (e.g. Are you comfortable with night shifts?)" />
          <Button type="submit" icon={<Plus className="size-3.5" />}>Add</Button>
        </form>
      </div>
    </Panel>
  );
}

function LibRow({ it, reload }: { it: { id: string; key: string; question: string; answer: string; category: string; verified: boolean }; reload: () => void }) {
  const [a, setA] = useState(it.answer);
  const { busy, run } = useAction();
  return (
    <div className="rounded-md border border-line p-2.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium">{it.question}</span>
        <span className="flex items-center gap-1.5">
          <Badge>{it.category}</Badge>
          {it.answer ? (it.verified ? <Badge tone="ok">verified</Badge> : <Badge tone="warn">unverified</Badge>) : <Badge tone="warn">empty</Badge>}
          <button aria-label="Delete" className="text-faint hover:text-bad" onClick={() => run("d", () => del(`/api/answer-library?id=${it.id}`), "Deleted").then(reload)}><Trash2 className="size-3.5" /></button>
        </span>
      </div>
      <div className="flex gap-2">
        <Textarea rows={Math.max(1, Math.ceil(a.length / 100))} className="min-h-0 py-1.5" value={a} onChange={(e) => setA(e.target.value)} placeholder="Your answer" />
        <Button size="sm" disabled={a === it.answer && it.verified} loading={busy === "s"} onClick={() => run("s", () => post("/api/answer-library", { key: it.key, question: it.question, answer: a, category: it.category, verified: true }), "Saved as verified").then(reload)}>Save</Button>
      </div>
    </div>
  );
}

function Extension() {
  const { data, reload } = useApi<{ tokens: { id: string; name: string; token_prefix: string; last_used_at: string | null; created_at: string }[] }>("/api/tokens");
  const [token, setToken] = useState<string | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <>
      <Panel title="Install">
        <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted">
          <li>Open <code className="rounded bg-subtle px-1">chrome://extensions</code> and enable <b>Developer mode</b>.</li>
          <li>Click <b>Load unpacked</b> and choose the <code className="rounded bg-subtle px-1">extension/</code> folder of this project.</li>
          <li>Open the extension, paste the app URL <code className="rounded bg-subtle px-1">{origin}</code> and a token from below.</li>
          <li>On any job page: Save Job / Analyze / Tailor / Prepare. On application forms: Fill form — it never clicks submit for you.</li>
        </ol>
      </Panel>
      <Panel title="Access tokens" actions={<Button size="sm" variant="primary" icon={<Key className="size-3.5" />} loading={busy === "n"} onClick={() => run("n", () => post<{ token: string }>("/api/tokens", { name: "Chrome extension" })).then((r) => { if (r) { setToken(r.token); reload(); } })}>Create token</Button>}>
        {(data?.tokens ?? []).length ? (
          <ul className="divide-y divide-line">
            {data!.tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2 text-[13px]">
                <span><code className="rounded bg-subtle px-1">{t.token_prefix}…</code> {t.name} <span className="text-faint">· created {timeAgo(t.created_at)} · last used {t.last_used_at ? timeAgo(t.last_used_at) : "never"}</span></span>
                <Button size="sm" variant="ghost" onClick={() => run("d", () => del(`/api/tokens?id=${t.id}`), "Revoked").then(reload)}>Revoke</Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">No tokens yet.</p>
        )}
      </Panel>
      <Modal open={!!token} onClose={() => setToken(null)} title="Your new token" footer={<Button variant="primary" onClick={() => setToken(null)}>Done</Button>}>
        <p className="mb-2 text-[13px] text-muted">Copy it now — it is stored only as a hash and can&apos;t be shown again.</p>
        <div className="flex gap-2"><Input readOnly value={token ?? ""} /><Button icon={<Copy className="size-3.5" />} onClick={() => token && navigator.clipboard.writeText(token).then(() => toast("Copied"))}>Copy</Button></div>
      </Modal>
    </>
  );
}

function Privacy() {
  const [scope, setScope] = useState<string | null>(null);
  const [confirmText, setConfirm] = useState("");
  const { busy, run } = useAction();
  const scopes = [
    ["resumes", "Uploaded resumes and tailored versions"],
    ["applications", "Applications, answers, letters, interviews, follow-ups"],
    ["jobs", "All discovered jobs and companies"],
    ["activity", "Agent tasks, activity log, notifications, browser history"],
    ["profile", "Master career profile (keeps settings)"],
    ["all", "Everything — all personal data and settings"],
  ];
  return (
    <>
      <Panel title="Export">
        <p className="mb-2 text-[13px] text-muted">Download all your data as JSON (secrets and token hashes excluded).</p>
        <Button icon={<Download className="size-3.5" />} loading={busy === "e"} onClick={() => run("e", () => downloadFile("/api/privacy/export"))}>Export my data</Button>
      </Panel>
      <Panel title="Delete">
        <ul className="divide-y divide-line">
          {scopes.map(([k, l]) => (
            <li key={k} className="flex items-center justify-between py-2 text-[13px]">
              <span>{l}</span>
              <Button size="sm" variant={k === "all" ? "danger" : "secondary"} onClick={() => { setScope(k); setConfirm(""); }}>Delete</Button>
            </li>
          ))}
        </ul>
      </Panel>
      <Modal open={!!scope} onClose={() => setScope(null)} title="Confirm deletion" footer={<><Button onClick={() => setScope(null)}>Cancel</Button><Button variant="danger" disabled={confirmText !== "DELETE"} loading={busy === "x"} onClick={() => run("x", () => post("/api/privacy/delete", { scope, confirm: confirmText }), "Deleted").then(() => { setScope(null); if (scope === "all") window.location.href = "/"; })}>Delete permanently</Button></>}>
        <p className="mb-2 text-[13px]">This permanently deletes: <b>{scopes.find((s) => s[0] === scope)?.[1]}</b>. Type <code>DELETE</code> to confirm.</p>
        <Input value={confirmText} onChange={(e) => setConfirm(e.target.value)} />
      </Modal>
    </>
  );
}
