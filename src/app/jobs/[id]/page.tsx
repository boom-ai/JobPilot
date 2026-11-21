"use client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ArrowLeft, Building2, Check, Copy, Download, ExternalLink, Globe, Mail, Plus, RefreshCw, Send, Sparkles, Star, Trash2, Wand2 } from "lucide-react";
import type { ApplicationStatus, JobRow, MatchAnalysis } from "@/lib/types";
import { APPLICATION_STATUSES, STATUS_LABEL } from "@/lib/types";
import { del, downloadFile, fmtDate, patch, post, put, timeAgo, useApi } from "@/lib/client";
import { Badge, Button, Empty, ErrorNote, Field, Input, Loading, Panel, Score, Select, Tabs, Textarea, recTone, useAction, Checkbox } from "@/components/ui";
import { CompanyLogo, JobMeta, MatchBreakdown, StatusBadge, sourceLabel } from "@/components/jobs";
import type { CompanyIntel } from "@/lib/ai/tasks";
import { ApprovalBox } from "@/components/approval";

interface Detail {
  job: JobRow & { ai_analysis: { summary?: string; required_skills?: string[]; preferred_skills?: string[]; responsibilities?: string[]; fit_notes?: string[]; gaps?: string[]; red_flags?: string[]; model?: string } | null };
  application: { id: string; application_status: ApplicationStatus; notes: string | null; follow_up_date: string | null; recruiter_details: Record<string, string>; offer_details: Record<string, string> | null; status_history: { from: string | null; to: string; at: string; by: string; note: string | null }[]; applied_at: string | null; mode: string | null; submission_evidence: Record<string, unknown> | null; review_data: Record<string, unknown> | null } | null;
  resume_versions: { id: string; version: number; file_name: string; method: string; created_at: string; change_log: { type: string; text: string }[] }[];
  letters: { id: string; kind: string; tone: string; content: string; flags: string[]; method: string; version: number; created_at: string }[];
  answers: { id: string; question: string; answer: string; source: string; flags: string[]; approved: boolean }[];
  sources: { source_name: string; source_url: string | null; created_at: string }[];
  tasks: { id: string; task_type: string; status: string; error: string | null; created_at: string }[];
  company: { company_data: { intel?: CompanyIntel } } | null;
  merged_duplicates: { id: string; title: string; company: string; source: string; source_url: string | null }[];
  ats: string | null;
}

type Tab = "overview" | "resume" | "letters" | "answers" | "company" | "apply";

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <JobDetail />
    </Suspense>
  );
}

function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>((sp.get("tab") as Tab) ?? "overview");
  const { data, error, loading, reload } = useApi<Detail>(`/api/jobs/${id}`);
  const { busy, run } = useAction();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return null;
  const { job } = data;
  const m = job.match_analysis as MatchAnalysis | null;
  const status = data.application?.application_status;
  return (
    <div className="space-y-4">
      <button onClick={() => router.back()} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Back</button>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <CompanyLogo job={job} size={44} />
          <div className="min-w-0">
            <h1 className="text-[20px] font-semibold tracking-tight">{job.title}</h1>
            <JobMeta job={job} />
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={status} />
              {m && <Badge tone={recTone(m.recommendation)}>{m.recommendation} match</Badge>}
              {data.ats && <Badge tone="info" title="Supported for assisted / automatic form filling by the local browser worker">{data.ats} form supported</Badge>}
              {job.deadline && <Badge tone="warn">Deadline {fmtDate(job.deadline)}</Badge>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Score value={job.match_score} size="lg" />
          <div className="flex flex-col gap-1.5">
            <Button size="sm" icon={<Star className="size-3.5" />} onClick={() => run("s", () => patch(`/api/jobs/${id}`, { action: status === "shortlisted" ? "unshortlist" : "shortlist" }), status === "shortlisted" ? "Removed from shortlist" : "Shortlisted").then(reload)}>{status === "shortlisted" ? "Unshortlist" : "Shortlist"}</Button>
            <Button size="sm" icon={<Sparkles className="size-3.5" />} loading={busy === "an"} onClick={() => run("an", () => post<{ aiError?: string }>(`/api/jobs/${id}/analyze`), (r) => (r.aiError ? `Re-scored (AI unavailable: ${r.aiError.slice(0, 60)})` : "Analysis updated")).then(reload)}>Analyze</Button>
          </div>
        </div>
      </div>

      <Tabs value={tab} onChange={setTab} items={[
        { value: "overview", label: "Overview" },
        { value: "resume", label: "Tailored resume", count: data.resume_versions.length },
        { value: "letters", label: "Cover letters", count: data.letters.length },
        { value: "answers", label: "Application answers", count: data.answers.length },
        { value: "company", label: "Company" },
        { value: "apply", label: "Apply & track" },
      ]} />

      {tab === "overview" && <Overview d={data} />}
      {tab === "resume" && <ResumeTab d={data} reload={reload} />}
      {tab === "letters" && <LettersTab d={data} reload={reload} />}
      {tab === "answers" && <AnswersTab d={data} reload={reload} />}
      {tab === "company" && <CompanyTab d={data} reload={reload} />}
      {tab === "apply" && <ApplyTab d={data} reload={reload} />}
    </div>
  );
}

function Overview({ d }: { d: Detail }) {
  const { job } = d;
  const m = job.match_analysis as MatchAnalysis | null;
  const ai = job.ai_analysis;
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        <Panel title="Match analysis">{m ? <MatchBreakdown m={m} /> : <p className="text-muted">Not scored yet — upload your resume and click Analyze.</p>}</Panel>
        {ai && (
          <Panel title="AI job analysis" actions={<span className="text-[11.5px] text-faint">{ai.model}</span>}>
            {ai.summary && <p className="mb-3 text-[13px]">{ai.summary}</p>}
            <div className="grid gap-3 md:grid-cols-2 text-[13px]">
              <TagBlock title="Required skills" items={ai.required_skills} />
              <TagBlock title="Preferred skills" items={ai.preferred_skills} />
              <ListB title="Responsibilities" items={ai.responsibilities} />
              <ListB title="How your real experience maps" items={ai.fit_notes} />
              <ListB title="Gaps" items={ai.gaps} />
              <ListB title="Red flags" items={ai.red_flags} />
            </div>
          </Panel>
        )}
        <Panel title="Job description">
          <div className="whitespace-pre-line text-[13px] leading-relaxed text-fg/90">{job.description || "No description captured."}</div>
        </Panel>
      </div>
      <div className="space-y-4 lg:col-span-2">
        <Panel title="Sources" bodyClass="space-y-1.5">
          {d.sources.map((s) => (
            <a key={s.source_name + s.source_url} href={s.source_url ?? "#"} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-md px-2 py-1.5 text-[13px] hover:bg-subtle">
              <span>{sourceLabel(s.source_name)} <span className="text-faint">{s.source_url ? new URL(s.source_url).host.replace(/^www\./, "") : ""}</span></span>
              <span className="flex items-center gap-1 text-[11.5px] text-faint">{timeAgo(s.created_at)} <ExternalLink className="size-3" /></span>
            </a>
          ))}
          {d.merged_duplicates.length > 0 && <p className="pt-1 text-[12px] text-faint">{d.merged_duplicates.length} duplicate listing(s) merged into this job.</p>}
        </Panel>
        <Panel title="Details">
          <dl className="grid grid-cols-2 gap-y-2 text-[12.5px]">
            <Dt k="Posted" v={fmtDate(job.posted_at)} />
            <Dt k="Discovered" v={fmtDate(job.discovered_at)} />
            <Dt k="Employment" v={job.job_type ?? "—"} />
            <Dt k="Work mode" v={job.remote_type ?? "—"} />
            <Dt k="Experience" v={job.experience_min != null ? `${job.experience_min}${job.experience_max != null ? `–${job.experience_max}` : "+"} yrs` : "Not stated"} />
            <Dt k="Countries" v={job.countries?.join(", ") || "—"} />
            <Dt k="Skills detected" v={job.skills?.join(", ") || "—"} />
          </dl>
        </Panel>
        {d.tasks.length > 0 && (
          <Panel title="Agent tasks for this job" bodyClass="p-0">
            <ul className="divide-y divide-line text-[12.5px]">
              {d.tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between px-3.5 py-2">
                  <span className="capitalize">{t.task_type.replace(/_/g, " ")}</span>
                  <Badge tone={t.status === "failed" ? "bad" : t.status === "completed" ? "ok" : "neutral"} title={t.error ?? undefined}>{t.status}</Badge>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}

function Dt({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="capitalize">{v}</dd>
    </>
  );
}
function TagBlock({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <h4 className="mb-1 text-[12px] font-semibold text-muted">{title}</h4>
      <div className="flex flex-wrap gap-1">{items.map((i) => <Badge key={i}>{i}</Badge>)}</div>
    </div>
  );
}
function ListB({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <h4 className="mb-1 text-[12px] font-semibold text-muted">{title}</h4>
      <ul className="list-disc space-y-0.5 pl-4">{items.map((i) => <li key={i}>{i}</li>)}</ul>
    </div>
  );
}

function ResumeTab({ d, reload }: { d: Detail; reload: () => void }) {
  const { busy, run } = useAction();
  const router = useRouter();
  return (
    <Panel title="Tailored resume versions" actions={<Button size="sm" variant="primary" icon={<Wand2 className="size-3.5" />} loading={busy === "t"} onClick={() => run("t", () => post<{ id: string; rejected: unknown[] }>(`/api/jobs/${d.job.id}/tailor`), (r) => `New version created${r.rejected.length ? ` — ${r.rejected.length} AI suggestion(s) rejected by truth check` : ""}`).then((r) => { reload(); if (r) router.push(`/resume/versions/${r.id}`); })}>Generate tailored resume</Button>}>
      {d.resume_versions.length ? (
        <ul className="divide-y divide-line">
          {d.resume_versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <Link href={`/resume/versions/${v.id}`} className="font-medium hover:text-accent">{v.file_name}</Link>
                <div className="text-[12px] text-muted">v{v.version} · {v.method === "ai" ? "AI rewrite (truth-checked)" : "rule-based"} · {timeAgo(v.created_at)} · {v.change_log.filter((c) => c.type === "change").length} changes{v.change_log.some((c) => c.type === "rejected") && ` · ${v.change_log.filter((c) => c.type === "rejected").length} rejected`}</div>
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" onClick={() => router.push(`/resume/versions/${v.id}`)}>Edit & compare</Button>
                <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => run("dl", () => downloadFile(`/api/resume-versions/${v.id}/export?format=pdf`))}>PDF</Button>
                <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => run("dl", () => downloadFile(`/api/resume-versions/${v.id}/export?format=docx`))}>DOCX</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No tailored resume yet">Generates a single-column, ATS-friendly resume from your master profile — reordered and reworded for this job, never inventing facts.</Empty>
      )}
    </Panel>
  );
}

const KINDS = [
  { v: "cover_letter", l: "Cover letter" },
  { v: "intro", l: "Short application intro" },
  { v: "recruiter", l: "Recruiter message" },
  { v: "linkedin", l: "LinkedIn outreach" },
  { v: "email", l: "Email application" },
];
const TONES = ["professional", "formal", "concise", "conversational"];

function LettersTab({ d, reload }: { d: Detail; reload: () => void }) {
  const [kind, setKind] = useState("cover_letter");
  const [tone, setTone] = useState("professional");
  const [custom, setCustom] = useState("");
  const { busy, run } = useAction();
  return (
    <div className="space-y-4">
      <Panel title="Generate">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Type" className="w-52"><Select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}</Select></Field>
          <Field label="Tone" className="w-44"><Select value={TONES.includes(tone) ? tone : "custom"} onChange={(e) => setTone(e.target.value === "custom" ? "" : e.target.value)}>{TONES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}<option value="custom">Custom…</option></Select></Field>
          {!TONES.includes(tone) && <Field label="Custom tone" className="w-44"><Input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="e.g. warm, upbeat" /></Field>}
          <Field label="Extra instruction (optional)" className="min-w-[220px] flex-1"><Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. mention I can start immediately" /></Field>
          <Button variant="primary" icon={<Mail className="size-3.5" />} loading={busy === "g"} onClick={() => run("g", () => post(`/api/jobs/${d.job.id}/letters`, { kind, tone: tone || "professional", instruction: custom || undefined }), "Generated").then(reload)}>Generate</Button>
        </div>
      </Panel>
      {d.letters.length ? d.letters.map((l) => <LetterCard key={l.id} l={l} reload={reload} />) : <Empty title="No letters yet">Letters use only facts from your master profile. Unknown details are flagged instead of guessed.</Empty>}
    </div>
  );
}

function LetterCard({ l, reload }: { l: Detail["letters"][number]; reload: () => void }) {
  const [text, setText] = useState(l.content);
  const { busy, run } = useAction();
  const dirty = text !== l.content;
  return (
    <Panel
      title={<span className="flex items-center gap-2">{KINDS.find((k) => k.v === l.kind)?.l} <Badge>{l.tone}</Badge> <Badge>{l.method === "ai" ? "AI" : "template"}</Badge> <span className="text-[11.5px] font-normal text-faint">v{l.version} · {timeAgo(l.created_at)}</span></span>}
      actions={
        <>
          <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => run("c", () => navigator.clipboard.writeText(text), "Copied")}>Copy</Button>
          <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={() => run("d", () => downloadFile(`/api/letters/${l.id}/export?format=docx`))}>DOCX</Button>
          <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={() => run("d", () => downloadFile(`/api/letters/${l.id}/export?format=pdf`))}>PDF</Button>
          <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => confirm("Delete this letter?") && run("x", () => del(`/api/letters/${l.id}`), "Deleted").then(reload)} />
        </>
      }
    >
      {l.flags.length > 0 && (
        <div className="mb-2 rounded-md bg-warn-soft px-2.5 py-1.5 text-[12.5px] text-warn">
          <b>Check before sending:</b> {l.flags.join(" · ")}
        </div>
      )}
      <Textarea rows={Math.min(18, Math.max(5, text.split("\n").length + 2))} value={text} onChange={(e) => setText(e.target.value)} />
      {dirty && (
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" onClick={() => setText(l.content)}>Revert</Button>
          <Button size="sm" variant="primary" loading={busy === "s"} onClick={() => run("s", () => put(`/api/letters/${l.id}`, { content: text }), "Saved").then(reload)}>Save</Button>
        </div>
      )}
    </Panel>
  );
}

function AnswersTab({ d, reload }: { d: Detail; reload: () => void }) {
  const [custom, setCustom] = useState("");
  const { busy, run } = useAction();
  return (
    <div className="space-y-4">
      <Panel title="Application questions" actions={<Button size="sm" variant="primary" icon={<RefreshCw className="size-3.5" />} loading={busy === "g"} onClick={() => run("g", () => post(`/api/jobs/${d.job.id}/answers`, {}), "Answers generated").then(reload)}>Generate standard answers</Button>}>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (custom.trim()) run("c", () => post(`/api/jobs/${d.job.id}/answers`, { questions: custom.split("\n").filter(Boolean) }), "Answered").then(() => { setCustom(""); reload(); }); }}>
          <Textarea rows={2} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Paste questions from the application form (one per line)…" />
          <Button type="submit" icon={<Plus className="size-3.5" />} loading={busy === "c"} disabled={!custom.trim()}>Answer</Button>
        </form>
        <p className="mt-2 text-[12px] text-faint">Answers reuse verified entries from your answer library first, then your profile. Anything unknown is flagged — fill it in once and save it to the library to reuse everywhere.</p>
      </Panel>
      {d.answers.length ? d.answers.map((a) => <AnswerRow key={a.id} a={a} reload={reload} />) : <Empty title="No answers yet" />}
    </div>
  );
}

function AnswerRow({ a, reload }: { a: Detail["answers"][number]; reload: () => void }) {
  const [text, setText] = useState(a.answer);
  const { busy, run } = useAction();
  return (
    <div className="rounded-lg border border-line bg-elev p-3">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{a.question}</span>
        <span className="flex items-center gap-1.5">
          <Badge>{a.source}</Badge>
          {a.approved ? <Badge tone="ok"><Check className="size-3" /> approved</Badge> : <Badge tone="warn">not approved</Badge>}
        </span>
      </div>
      {a.flags.length > 0 && <p className="mb-1.5 text-[12px] text-warn">⚠ {a.flags.join(" · ")}</p>}
      <Textarea rows={Math.min(8, Math.max(2, Math.ceil(text.length / 110)))} value={text} onChange={(e) => setText(e.target.value)} placeholder="Unknown — type your answer" />
      <div className="mt-2 flex flex-wrap justify-end gap-1.5">
        <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => run("d", () => del(`/api/answers/${a.id}`), "Removed").then(reload)} />
        <Button size="sm" onClick={() => run("s", () => patch(`/api/answers/${a.id}`, { answer: text, approved: true, save_to_library: true }), "Approved & saved to library").then(reload)} disabled={!text.trim()}>Approve + save to library</Button>
        <Button size="sm" variant="primary" loading={busy === "a"} disabled={!text.trim()} onClick={() => run("a", () => patch(`/api/answers/${a.id}`, { answer: text, approved: true }), "Approved").then(reload)}>{text !== a.answer ? "Save & approve" : a.approved ? "Approved" : "Approve"}</Button>
      </div>
    </div>
  );
}

function CompanyTab({ d, reload }: { d: Detail; reload: () => void }) {
  const intel = d.company?.company_data?.intel;
  const { busy, run } = useAction();
  return (
    <Panel title={<span className="flex items-center gap-2"><Building2 className="size-4" /> {d.job.company}</span>} actions={<Button size="sm" variant="primary" loading={busy === "r"} icon={<RefreshCw className="size-3.5" />} onClick={() => run("r", () => post("/api/companies/intel", { name: d.job.company }), "Research updated").then(reload)}>{intel ? "Refresh research" : "Research company"}</Button>}>
      {!intel ? (
        <Empty title="Not researched yet">Uses Gemini with Google Search grounding when configured. Verified facts are shown with their sources; everything else is labelled as inference.</Empty>
      ) : (
        <div className="space-y-4 text-[13px]">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <Badge tone={intel.method === "ai-grounded" ? "ok" : "warn"}>{intel.method === "ai-grounded" ? "Grounded in web sources" : intel.method === "ai" ? "AI without web access — treat as unverified" : "From your job listings only"}</Badge>
            Researched {timeAgo(intel.researched_at)}
            {intel.website && <a className="text-accent hover:underline" href={intel.website} target="_blank" rel="noreferrer">{intel.website}</a>}
          </div>
          <p>{intel.summary}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <ListB title="Products" items={intel.products} />
            <ListB title="Recent news" items={intel.recent_news} />
            <ListB title="Hiring trends" items={intel.hiring_trends} />
            <ListB title="Interview process" items={intel.interview_process} />
          </div>
          {intel.verified.length > 0 && (
            <div>
              <h4 className="mb-1 text-[12px] font-semibold text-ok">Verified facts</h4>
              <ul className="space-y-1">{intel.verified.map((v) => <li key={v.fact}>{v.fact} <a className="text-[11.5px] text-faint hover:text-fg" href={v.source} target="_blank" rel="noreferrer">[source]</a></li>)}</ul>
            </div>
          )}
          {intel.inferred.length > 0 && (
            <div>
              <h4 className="mb-1 text-[12px] font-semibold text-warn">AI inference — not verified</h4>
              <ul className="list-disc space-y-0.5 pl-4 text-muted">{intel.inferred.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          )}
          {intel.sources.length > 0 && (
            <div className="border-t border-line pt-3">
              <h4 className="mb-1 text-[12px] font-semibold text-muted">Sources</h4>
              <ul className="space-y-0.5 text-[12px]">{intel.sources.map((s) => <li key={s.url}><a className="text-accent hover:underline" href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a></li>)}</ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function ApplyTab({ d, reload }: { d: Detail; reload: () => void }) {
  const app = d.application;
  const { busy, run } = useAction();
  const router = useRouter();
  const [notes, setNotes] = useState(app?.notes ?? "");
  const [follow, setFollow] = useState(app?.follow_up_date ?? "");
  const [rec, setRec] = useState<Record<string, string>>(app?.recruiter_details ?? {});
  const [confirmApplied, setConfirmApplied] = useState(false);
  const url = d.job.apply_url ?? d.job.source_url;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Apply">
        <div className="space-y-3 text-[13px]">
          <ol className="list-decimal space-y-1 pl-5 text-muted">
            <li className={d.resume_versions.length ? "text-ok" : ""}>Tailored resume {d.resume_versions.length ? "ready" : "— will be generated"}</li>
            <li className={d.letters.some((l) => l.kind === "cover_letter") ? "text-ok" : ""}>Cover letter {d.letters.some((l) => l.kind === "cover_letter") ? "ready" : "— will be generated"}</li>
            <li className={d.answers.length ? "text-ok" : ""}>Application answers {d.answers.length ? `(${d.answers.filter((a) => a.approved).length}/${d.answers.length} approved)` : "— will be generated"}</li>
            <li>Submit via {d.ats ? `${d.ats} form (browser worker or extension)` : "the site (extension assists with filling)"}</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<Send className="size-3.5" />} loading={busy === "p"} onClick={() => run("p", () => post<{ route: string; reason?: string }>(`/api/jobs/${d.job.id}/prepare`), (r) => (r.route === "manual" ? `Package ready. ${r.reason ?? ""}` : r.route === "already_applied" ? r.reason ?? "" : r.route === "limited" ? `Held: ${r.reason}` : `Queued for ${r.route === "auto" ? "auto-submit" : "assisted fill"} by the local browser worker`)).then(reload)}>Prepare application</Button>
            {d.ats && <Button loading={busy === "pa"} onClick={() => run("pa", () => post<{ route: string; reason?: string }>(`/api/jobs/${d.job.id}/prepare`, { mode: "assisted" }), (r) => (r.route === "assisted" ? "Queued: browser worker will fill the form and wait for your approval" : r.reason ?? r.route)).then(reload)}>Assisted fill (review first)</Button>}
            <Button icon={<Globe className="size-3.5" />} onClick={() => router.push(`/browser?job=${d.job.id}`)}>Open in Browser Workspace</Button>
            {url && <a href={url} target="_blank" rel="noreferrer"><Button icon={<ExternalLink className="size-3.5" />}>Open application page</Button></a>}
          </div>
          {app?.application_status === "awaiting_approval" && <ApprovalBox app={app} reload={reload} />}
          <div className="rounded-md border border-line p-3">
            <Checkbox checked={confirmApplied} onChange={setConfirmApplied} label="I submitted this application myself" />
            <Button size="sm" className="mt-2" disabled={!confirmApplied} onClick={() => run("m", () => patch(`/api/jobs/${d.job.id}`, { action: "status", status: "applied", note: "Confirmed by user" }), "Marked as applied").then(() => { setConfirmApplied(false); reload(); })}>Mark as applied</Button>
            <p className="mt-1.5 text-[11.5px] text-faint">Job Pilot never records a submission unless you confirm it or a confirmation page is detected.</p>
          </div>
        </div>
      </Panel>
      <Panel title="Tracking">
        <div className="space-y-3">
          <Field label="Status">
            <Select value={app?.application_status ?? "discovered"} onChange={(e) => run("st", () => patch(`/api/jobs/${d.job.id}`, { action: "status", status: e.target.value }), "Status updated").then(reload)}>
              {APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Recruiter name"><Input value={rec.name ?? ""} onChange={(e) => setRec({ ...rec, name: e.target.value })} /></Field>
            <Field label="Recruiter email / contact"><Input value={rec.contact ?? ""} onChange={(e) => setRec({ ...rec, contact: e.target.value })} /></Field>
          </div>
          <Field label="Follow-up date"><Input type="date" value={follow ?? ""} onChange={(e) => setFollow(e.target.value)} /></Field>
          <Field label="Notes"><Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <Button variant="primary" size="sm" loading={busy === "save"} disabled={!app} onClick={() => run("save", () => patch(`/api/applications/${app!.id}`, { notes, follow_up_date: follow || null, recruiter_details: rec }), "Saved").then(reload)}>Save tracking details</Button>
          {!app && <p className="text-[12px] text-faint">Shortlist or prepare this job to start tracking it.</p>}
          {app && app.status_history.length > 0 && (
            <div className="border-t border-line pt-3">
              <h4 className="mb-1.5 text-[12px] font-semibold text-muted">History</h4>
              <ul className="space-y-1 text-[12.5px]">
                {[...app.status_history].reverse().map((h, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span>{h.from ? `${STATUS_LABEL[h.from as ApplicationStatus] ?? h.from} → ` : ""}<b>{STATUS_LABEL[h.to as ApplicationStatus] ?? h.to}</b>{h.note && <span className="text-muted"> · {h.note}</span>}</span>
                    <span className="shrink-0 text-faint">{h.by} · {timeAgo(h.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
