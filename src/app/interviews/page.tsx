"use client";
import Link from "next/link";
import { useState } from "react";
import { CalendarClock, Plus, Sparkles, Trash2 } from "lucide-react";
import { del, fmtDate, patch, post, useApi } from "@/lib/client";
import type { InterviewPrep } from "@/lib/ai/tasks";
import { Badge, Button, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Panel, Select, Textarea, cn, useAction } from "@/components/ui";

interface Interview {
  id: string;
  application_id: string;
  scheduled_at: string | null;
  round: number;
  interview_type: string | null;
  details: { interviewers?: string; link?: string };
  prep: InterviewPrep | null;
  notes: string | null;
  status: "scheduled" | "completed" | "cancelled";
  applications: { id: string; job_id: string; application_status: string; jobs: { id: string; title: string; company: string } };
}
interface AppOpt {
  id: string;
  job_id: string;
  application_status: string;
  jobs: { title: string; company: string } | null;
}

export default function InterviewsPage() {
  const { data, error, loading, reload } = useApi<{ interviews: Interview[] }>("/api/interviews");
  const [sel, setSel] = useState<string | null>(null);
  const [add, setAdd] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  const list = data?.interviews ?? [];
  const now = new Date().toISOString();
  const upcoming = list.filter((i) => i.status === "scheduled" && (!i.scheduled_at || i.scheduled_at >= now));
  const past = list.filter((i) => !upcoming.includes(i));
  const current = list.find((i) => i.id === sel) ?? upcoming[0] ?? list[0] ?? null;
  return (
    <div className="space-y-4">
      <PageHeader title="Interview Center" subtitle="Rounds, schedules, notes and preparation grounded in your real experience." actions={<Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdd(true)}>Add interview</Button>} />
      {!list.length ? (
        <Empty icon={<CalendarClock className="size-6" />} title="No interviews yet" action={<Button onClick={() => setAdd(true)}>Add interview</Button>}>When an application reaches the interview stage, add the round here to get a preparation guide.</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-3">
            <Group title="Upcoming" items={upcoming} sel={current?.id} onSel={setSel} />
            <Group title="Past & completed" items={past} sel={current?.id} onSel={setSel} />
          </div>
          {current && <InterviewDetail key={current.id} iv={current} reload={reload} />}
        </div>
      )}
      {add && <AddInterview onClose={() => setAdd(false)} onDone={() => { setAdd(false); reload(); }} />}
    </div>
  );
}

function Group({ title, items, sel, onSel }: { title: string; items: Interview[]; sel?: string; onSel: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <Panel title={title} bodyClass="p-1.5">
      {items.map((i) => (
        <button key={i.id} onClick={() => onSel(i.id)} className={cn("block w-full rounded-md px-2.5 py-2 text-left", sel === i.id ? "bg-subtle" : "hover:bg-subtle")}>
          <div className="truncate font-medium">{i.applications.jobs.company} · Round {i.round}</div>
          <div className="truncate text-[12px] text-muted">{i.applications.jobs.title}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-faint">{i.scheduled_at ? fmtDate(i.scheduled_at, true) : "Not scheduled"} {i.interview_type && <Badge>{i.interview_type}</Badge>} {i.status !== "scheduled" && <Badge tone={i.status === "completed" ? "ok" : "bad"}>{i.status}</Badge>}</div>
        </button>
      ))}
    </Panel>
  );
}

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function InterviewDetail({ iv, reload }: { iv: Interview; reload: () => void }) {
  const [when, setWhen] = useState(toLocalInput(iv.scheduled_at));
  const [type, setType] = useState(iv.interview_type ?? "");
  const [notes, setNotes] = useState(iv.notes ?? "");
  const [who, setWho] = useState(iv.details?.interviewers ?? "");
  const [link, setLink] = useState(iv.details?.link ?? "");
  const { busy, run } = useAction();
  const p = iv.prep;
  return (
    <div className="space-y-4">
      <Panel title={<Link href={`/jobs/${iv.applications.job_id}`} className="hover:text-accent">{iv.applications.jobs.title} — {iv.applications.jobs.company} · Round {iv.round}</Link>} actions={
        <>
          <Select className="h-7 w-32 text-[12.5px]" value={iv.status} onChange={(e) => run("st", () => patch(`/api/interviews/${iv.id}`, { status: e.target.value }), "Updated").then(reload)}>
            <option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
          </Select>
          <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => confirm("Delete this interview?") && run("d", () => del(`/api/interviews/${iv.id}`), "Deleted").then(reload)} />
        </>
      }>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date & time"><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
          <Field label="Type"><Input value={type} onChange={(e) => setType(e.target.value)} placeholder="HR screen, technical, assessment…" /></Field>
          <Field label="Interviewers"><Input value={who} onChange={(e) => setWho(e.target.value)} /></Field>
          <Field label="Meeting link"><Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" /></Field>
        </div>
        <Field label="Notes" className="mt-3"><Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" onClick={() => run("next", () => post("/api/interviews", { application_id: iv.application_id, round: iv.round + 1 }), `Round ${iv.round + 1} added`).then(reload)}>Add next round</Button>
          <Button size="sm" variant="primary" loading={busy === "save"} onClick={() => run("save", () => patch(`/api/interviews/${iv.id}`, { scheduled_at: when ? new Date(when).toISOString() : null, interview_type: type || null, notes, details: { ...iv.details, interviewers: who, link } }), "Saved — reminder 24h before").then(reload)}>Save</Button>
        </div>
      </Panel>
      <Panel title="Preparation" actions={<Button size="sm" variant="primary" icon={<Sparkles className="size-3.5" />} loading={busy === "prep"} onClick={() => run("prep", () => post(`/api/interviews/${iv.id}/prep`), "Preparation guide ready").then(reload)}>{p ? "Regenerate" : "Generate prep"}</Button>}>
        {!p ? (
          <p className="text-muted">Generates a company and role overview, JD analysis, likely questions, and suggested answers built only from your experience. Run Company research on the job first for sourced company facts.</p>
        ) : (
          <div className="space-y-4 text-[13px]">
            <Badge tone={p.method === "ai" ? "accent" : "neutral"}>{p.method === "ai" ? "AI-generated, grounded in your profile" : "Rule-based (no AI configured)"}</Badge>
            <Sec title="Company overview"><p>{p.company_overview}</p>{p.verified_facts.length > 0 && <p className="mt-1 text-[12px] text-ok">Verified: {p.verified_facts.join(" · ")}</p>}{p.inferred.length > 0 && <p className="mt-1 text-[12px] text-warn">Unverified / inferred: {p.inferred.join(" · ")}</p>}</Sec>
            <Sec title="Role overview"><p>{p.role_overview}</p></Sec>
            <Sec title="Job description analysis"><Ul items={p.jd_analysis} /></Sec>
            <Sec title="Your relevant experience"><Ul items={p.relevant_experience} /></Sec>
            <Sec title="Preparation guide"><Ul items={p.preparation_guide} /></Sec>
            <Sec title="Likely questions"><Ul items={p.likely_questions} /></Sec>
            {[...p.behavioral_questions, ...p.technical_questions].length > 0 && (
              <Sec title="Suggested answers">
                <div className="space-y-2">
                  {[...p.behavioral_questions, ...p.technical_questions].map((q) => (
                    <div key={q.question} className="rounded-md border border-line p-2.5">
                      <p className="font-medium">{q.question}</p>
                      <p className="mt-1 whitespace-pre-line text-muted">{q.suggested_answer.split(/(\[\[UNKNOWN:[^\]]+\]\])/).map((part, i) => (part.startsWith("[[UNKNOWN") ? <span key={i} className="rounded bg-warn-soft px-1 text-warn">{part.slice(10, -2)}</span> : part))}</p>
                    </div>
                  ))}
                </div>
              </Sec>
            )}
            <Sec title="Questions to ask"><Ul items={p.questions_to_ask} /></Sec>
            <Sec title="Checklist"><Ul items={p.checklist} /></Sec>
            {p.sources.length > 0 && <Sec title="Sources"><ul className="text-[12px]">{p.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{s.title || s.url}</a></li>)}</ul></Sec>}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-faint">{title}</h4>
      {children}
    </section>
  );
}
function Ul({ items }: { items: string[] }) {
  return items.length ? <ul className="list-disc space-y-0.5 pl-4">{items.map((i) => <li key={i}>{i}</li>)}</ul> : <p className="text-faint">—</p>;
}

function AddInterview({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data } = useApi<{ applications: AppOpt[] }>("/api/applications");
  const [app, setApp] = useState("");
  const [when, setWhen] = useState("");
  const [type, setType] = useState("");
  const { busy, run } = useAction();
  const opts = (data?.applications ?? []).filter((a) => a.jobs);
  return (
    <Modal open onClose={onClose} title="Add interview" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!app} loading={busy === "a"} onClick={() => run("a", () => post("/api/interviews", { application_id: app, scheduled_at: when ? new Date(when).toISOString() : null, interview_type: type || null }), "Interview added — application moved to Interview").then((r) => r && onDone())}>Add</Button></>}>
      <div className="space-y-3">
        <Field label="Application">
          <Select value={app} onChange={(e) => setApp(e.target.value)}>
            <option value="">Select…</option>
            {opts.map((a) => <option key={a.id} value={a.id}>{a.jobs!.title} — {a.jobs!.company} ({a.application_status.replace(/_/g, " ")})</option>)}
          </Select>
        </Field>
        <Field label="Date & time"><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        <Field label="Type"><Input value={type} onChange={(e) => setType(e.target.value)} placeholder="HR screen" /></Field>
      </div>
    </Modal>
  );
}
