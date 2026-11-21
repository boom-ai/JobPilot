"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Calendar as CalIcon, ChevronLeft, ChevronRight, Kanban, Table2 } from "lucide-react";
import { APPLICATION_STATUSES, STATUS_LABEL, type ApplicationStatus } from "@/lib/types";
import { fmtDate, fmtSalary, patch, timeAgo, useApi } from "@/lib/client";
import { Badge, Button, Empty, ErrorNote, Input, Loading, PageHeader, Score, Segmented, Select, cn, useAction } from "@/components/ui";
import { statusTone, sourceLabel } from "@/components/jobs";

interface App {
  id: string;
  job_id: string;
  application_status: ApplicationStatus;
  applied_at: string | null;
  shortlisted_at: string | null;
  follow_up_date: string | null;
  notes: string | null;
  updated_at: string;
  created_at: string;
  recruiter_details: { name?: string; contact?: string };
  resume_version_id: string | null;
  jobs: { id: string; title: string; company: string; location: string | null; remote_type: string | null; source: string; match_score: number | null; salary_min: number | null; salary_max: number | null; currency: string | null; salary_period: string | null; discovered_at: string; deadline: string | null } | null;
  interviews: { id: string; scheduled_at: string | null; round: number; interview_type: string | null; status: string }[];
  followups: { id: string; due_at: string; status: string; type: string }[];
}

const KANBAN: ApplicationStatus[] = ["shortlisted", "resume_generated", "ready_to_apply", "awaiting_approval", "applied", "recruiter_contacted", "assessment", "interview", "offer", "rejected"];

export default function ApplicationsPage() {
  const { data, error, loading, reload, setData } = useApi<{ applications: App[] }>("/api/applications");
  const [view, setView] = useState<"table" | "kanban" | "calendar">("table");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("");
  const [sort, setSort] = useState<"updated" | "applied" | "score" | "company">("updated");
  const { run } = useAction();

  const rows = useMemo(() => {
    let r = (data?.applications ?? []).filter((a) => a.jobs);
    if (q) r = r.filter((a) => `${a.jobs!.title} ${a.jobs!.company} ${a.notes ?? ""} ${a.recruiter_details?.name ?? ""}`.toLowerCase().includes(q.toLowerCase()));
    if (status) r = r.filter((a) => a.application_status === status);
    const by = {
      updated: (a: App, b: App) => b.updated_at.localeCompare(a.updated_at),
      applied: (a: App, b: App) => (b.applied_at ?? "").localeCompare(a.applied_at ?? ""),
      score: (a: App, b: App) => (b.jobs!.match_score ?? 0) - (a.jobs!.match_score ?? 0),
      company: (a: App, b: App) => a.jobs!.company.localeCompare(b.jobs!.company),
    }[sort];
    return [...r].sort(by);
  }, [data, q, status, sort]);

  const setStatusFor = (a: App, s: ApplicationStatus) => {
    // optimistic
    setData((d) => (d ? { applications: d.applications.map((x) => (x.id === a.id ? { ...x, application_status: s } : x)) } : d));
    run("st", () => patch(`/api/applications/${a.id}`, { status: s }), `Moved to ${STATUS_LABEL[s]}`).then(() => reload(true));
  };

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Applications"
        subtitle="Every job you've saved, prepared or applied to. Statuses only change automatically on reliable evidence."
        actions={<Segmented value={view} onChange={setView} items={[{ value: "table", label: "Table", icon: <Table2 className="size-3.5" /> }, { value: "kanban", label: "Kanban", icon: <Kanban className="size-3.5" /> }, { value: "calendar", label: "Calendar", icon: <CalIcon className="size-3.5" /> }]} />}
      />
      <div className="flex flex-wrap gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, company, notes, recruiter…" className="max-w-xs" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="">All statuses</option>
          {APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="w-48">
          <option value="updated">Sort: last updated</option>
          <option value="applied">Sort: date applied</option>
          <option value="score">Sort: match score</option>
          <option value="company">Sort: company</option>
        </Select>
      </div>
      {!rows.length ? (
        <Empty title="No applications yet">Shortlist or prepare jobs to start tracking them here.</Empty>
      ) : view === "table" ? (
        <div className="overflow-x-auto rounded-lg border border-line bg-elev">
          <table className="w-full text-[13px]">
            <thead className="border-b border-line text-left text-[11.5px] text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Job</th>
                <th className="px-3 py-2 font-medium">Score</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Applied</th>
                <th className="px-3 py-2 font-medium">Follow-up</th>
                <th className="px-3 py-2 font-medium">Next interview</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Salary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((a) => {
                const next = a.interviews.filter((i) => i.status === "scheduled" && i.scheduled_at).sort((x, y) => x.scheduled_at!.localeCompare(y.scheduled_at!))[0];
                return (
                  <tr key={a.id} className="hover:bg-subtle">
                    <td className="max-w-[320px] px-3 py-2">
                      <Link href={`/jobs/${a.job_id}?tab=apply`} className="block truncate font-medium hover:text-accent">{a.jobs!.title}</Link>
                      <span className="block truncate text-[12px] text-muted">{a.jobs!.company}{a.jobs!.location ? ` · ${a.jobs!.location}` : ""}</span>
                    </td>
                    <td className="px-3 py-2"><Score value={a.jobs!.match_score} size="sm" /></td>
                    <td className="px-3 py-2">
                      <Select value={a.application_status} onChange={(e) => setStatusFor(a, e.target.value as ApplicationStatus)} className="h-7 w-44 text-[12.5px]">
                        {APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </Select>
                    </td>
                    <td className="px-3 py-2 text-muted">{a.applied_at ? fmtDate(a.applied_at) : "—"}</td>
                    <td className={cn("px-3 py-2", a.follow_up_date && a.follow_up_date <= new Date().toISOString().slice(0, 10) ? "text-warn" : "text-muted")}>{a.follow_up_date ? fmtDate(a.follow_up_date) : "—"}</td>
                    <td className="px-3 py-2 text-muted">{next ? fmtDate(next.scheduled_at, true) : "—"}</td>
                    <td className="px-3 py-2 text-muted">{sourceLabel(a.jobs!.source)}</td>
                    <td className="px-3 py-2 text-muted">{fmtSalary(a.jobs!) ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : view === "kanban" ? (
        <KanbanView rows={rows} onMove={setStatusFor} />
      ) : (
        <CalendarView rows={rows} />
      )}
    </div>
  );
}

function KanbanView({ rows, onMove }: { rows: App[]; onMove: (a: App, s: ApplicationStatus) => void }) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const extra = rows.filter((r) => !KANBAN.includes(r.application_status));
  return (
    <div className="scroll-thin flex gap-3 overflow-x-auto pb-3">
      {KANBAN.map((col) => {
        const items = rows.filter((r) => r.application_status === col);
        return (
          <div
            key={col}
            onDragOver={(e) => { e.preventDefault(); setOver(col); }}
            onDragLeave={() => setOver(null)}
            onDrop={() => {
              const a = rows.find((r) => r.id === drag);
              if (a && a.application_status !== col) onMove(a, col);
              setDrag(null);
              setOver(null);
            }}
            className={cn("flex w-[250px] shrink-0 flex-col rounded-lg border bg-subtle/40", over === col ? "border-accent" : "border-line")}
          >
            <div className="flex h-9 items-center justify-between border-b border-line px-3 text-[12.5px] font-medium">
              <span className="flex items-center gap-1.5"><span className={cn("size-2 rounded-full", { ok: "bg-ok", info: "bg-info", accent: "bg-accent", warn: "bg-warn", bad: "bg-bad", neutral: "bg-faint" }[statusTone(col)])} />{STATUS_LABEL[col]}</span>
              <span className="text-faint">{items.length}</span>
            </div>
            <div className="min-h-[120px] space-y-2 p-2">
              {items.map((a) => (
                <div key={a.id} draggable onDragStart={() => setDrag(a.id)} className="cursor-grab rounded-md border border-line bg-elev p-2.5 active:cursor-grabbing">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/jobs/${a.job_id}?tab=apply`} className="text-[12.5px] font-medium leading-snug hover:text-accent">{a.jobs!.title}</Link>
                    <Score value={a.jobs!.match_score} size="sm" />
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-muted">{a.jobs!.company}</p>
                  <p className="mt-1 text-[11px] text-faint">{timeAgo(a.updated_at)}</p>
                  <Select aria-label="Move to" value={a.application_status} onChange={(e) => onMove(a, e.target.value as ApplicationStatus)} className="mt-1.5 h-6 text-[11.5px]">
                    {APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </Select>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {extra.length > 0 && (
        <div className="w-[220px] shrink-0 rounded-lg border border-line p-3 text-[12.5px] text-muted">
          <p className="mb-1 font-medium text-fg">Other</p>
          {extra.map((a) => <p key={a.id} className="truncate">{a.jobs!.title} · <Badge>{STATUS_LABEL[a.application_status]}</Badge></p>)}
        </div>
      )}
    </div>
  );
}

function CalendarView({ rows }: { rows: App[] }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const events = useMemo(() => {
    const ev: { date: string; label: string; href: string; tone: "accent" | "info" | "warn" | "bad" }[] = [];
    for (const a of rows) {
      const href = `/jobs/${a.job_id}?tab=apply`;
      if (a.applied_at) ev.push({ date: a.applied_at.slice(0, 10), label: `Applied · ${a.jobs!.company}`, href, tone: "accent" });
      for (const i of a.interviews) if (i.scheduled_at) ev.push({ date: localDate(i.scheduled_at), label: `Interview R${i.round} · ${a.jobs!.company}`, href: "/interviews", tone: "info" });
      if (a.follow_up_date) ev.push({ date: a.follow_up_date.slice(0, 10), label: `Follow up · ${a.jobs!.company}`, href, tone: "warn" });
      if (a.jobs!.deadline) ev.push({ date: a.jobs!.deadline.slice(0, 10), label: `Deadline · ${a.jobs!.company}`, href, tone: "bad" });
    }
    return ev;
  }, [rows]);
  const start = new Date(month);
  start.setDate(1 - ((start.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const today = localDate(new Date().toISOString());
  return (
    <div className="rounded-lg border border-line bg-elev">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="font-semibold">{month.toLocaleString("en-IN", { month: "long", year: "numeric" })}</span>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft className="size-4" /></Button>
          <Button size="sm" variant="ghost" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</Button>
          <Button size="sm" variant="ghost" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight className="size-4" /></Button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-line text-center text-[11.5px] text-muted">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-1.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const ev = events.filter((e) => e.date === key);
          return (
            <div key={key} className={cn("min-h-[92px] border-b border-r border-line p-1.5", d.getMonth() !== month.getMonth() && "bg-subtle/50 text-faint")}>
              <div className={cn("mb-1 text-[11.5px]", key === today && "inline-flex size-5 items-center justify-center rounded-full bg-accent font-semibold text-accent-fg")}>{d.getDate()}</div>
              <div className="space-y-0.5">
                {ev.slice(0, 4).map((e, i) => (
                  <Link key={i} href={e.href} className={cn("block truncate rounded px-1 text-[11px]", { accent: "bg-accent-soft text-accent", info: "bg-info-soft text-info", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad" }[e.tone])}>{e.label}</Link>
                ))}
                {ev.length > 4 && <span className="text-[10.5px] text-faint">+{ev.length - 4} more</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function localDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
