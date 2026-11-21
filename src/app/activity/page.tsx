"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { OctagonX, Pause, Play, RotateCw, Search, Trash2, X, Zap } from "lucide-react";
import { post, timeAgo, useApi, usePoll, fmtDate } from "@/lib/client";
import { Badge, Button, Empty, ErrorNote, Loading, PageHeader, Panel, Segmented, Tabs, cn, useAction } from "@/components/ui";
import { useMe } from "@/components/shell";

interface Task {
  id: string;
  task_type: string;
  status: string;
  job_id: string | null;
  error: string | null;
  retry_count: number;
  logs: { at: string; msg: string }[];
  result: Record<string, unknown> | null;
  requires_browser: boolean;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  run_after: string;
  jobs: { title: string; company: string } | null;
}
interface Resp {
  state: "running" | "paused" | "stopped";
  tasks: Task[];
  events: { id: string; kind: string; message: string; created_at: string; data: Record<string, unknown> }[];
  queue: Record<string, number>;
  current: Task | null;
}

const TONE: Record<string, "ok" | "bad" | "warn" | "info" | "neutral"> = { completed: "ok", failed: "bad", waiting_user: "warn", running: "info", pending: "neutral", cancelled: "neutral" };

export default function ActivityPage() {
  const { data, error, loading, reload } = useApi<Resp>("/api/agent?limit=150");
  const silent = useCallback(() => reload(true), [reload]);
  usePoll(silent, 5000);
  const { refresh } = useMe();
  const { busy, run } = useAction();
  const [tab, setTab] = useState<"tasks" | "feed">("tasks");
  const [filter, setFilter] = useState<"all" | "active" | "failed">("all");
  const [open, setOpen] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return null;
  const control = (action: string, msg: string) => run(action, () => post("/api/agent", { action }), msg).then(() => { reload(); refresh(); });
  const tasks = data.tasks.filter((t) => (filter === "active" ? ["pending", "running", "waiting_user"].includes(t.status) : filter === "failed" ? t.status === "failed" : true));
  return (
    <div className="space-y-4">
      <PageHeader
        title="AI Agent Activity"
        subtitle="Every action the agent took — generated from real task logs."
        actions={
          <>
            {data.state === "running" ? (
              <Button icon={<Pause className="size-3.5" />} onClick={() => control("pause", "Paused")}>Pause</Button>
            ) : (
              <Button icon={<Play className="size-3.5" />} onClick={() => control("resume", "Resumed")}>{data.state === "stopped" ? "Start" : "Resume"}</Button>
            )}
            <Button icon={<Search className="size-3.5" />} loading={busy === "search_now"} onClick={() => control("search_now", "Search complete")}>Search now</Button>
            <Button icon={<Zap className="size-3.5" />} loading={busy === "run_now"} disabled={data.state !== "running"} onClick={() => control("run_now", "Processed queued tasks")}>Process queue</Button>
            <Button variant="danger" icon={<OctagonX className="size-3.5" />} onClick={() => confirm("Emergency stop: cancel every queued and running task?") && control("stop", "Emergency stop — all tasks cancelled")}>Emergency stop</Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Card label="State" value={<Badge tone={data.state === "running" ? "ok" : data.state === "paused" ? "warn" : "bad"}>{data.state}</Badge>} />
        <Card label="Running" value={data.queue.running ?? 0} />
        <Card label="Pending" value={data.queue.pending ?? 0} />
        <Card label="Needs you" value={data.queue.waiting_user ?? 0} />
        <Card label="Now" value={<span className="truncate text-[12.5px] font-normal">{data.current ? `${data.current.task_type.replace(/_/g, " ")}${data.current.jobs ? ` · ${data.current.jobs.company}` : ""}` : "Idle"}</span>} />
      </div>
      <div className="flex items-center justify-between">
        <Tabs value={tab} onChange={setTab} items={[{ value: "tasks", label: "Task queue" }, { value: "feed", label: "Activity feed" }]} />
        {tab === "tasks" && (
          <div className="flex items-center gap-2">
            <Segmented value={filter} onChange={setFilter} items={[{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "failed", label: "Failed" }]} />
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => control("clear_finished", "Cleared finished tasks")}>Clear finished</Button>
          </div>
        )}
      </div>
      {tab === "tasks" ? (
        tasks.length ? (
          <Panel bodyClass="p-0">
            <ul className="divide-y divide-line">
              {tasks.map((t) => (
                <li key={t.id}>
                  <button onClick={() => setOpen(open === t.id ? null : t.id)} className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-subtle">
                    <span className="min-w-0">
                      <span className="font-medium capitalize">{t.task_type.replace(/_/g, " ")}</span>
                      {t.jobs && <span className="text-muted"> · {t.jobs.title} — {t.jobs.company}</span>}
                      {t.requires_browser && <Badge className="ml-2">browser</Badge>}
                      <span className="block text-[11.5px] text-faint">created {timeAgo(t.created_at)}{t.finished_at && ` · finished ${timeAgo(t.finished_at)}`}{t.retry_count > 0 && ` · ${t.retry_count} retr${t.retry_count === 1 ? "y" : "ies"}`}{t.status === "pending" && new Date(t.run_after) > new Date() && ` · next attempt ${timeAgo(t.run_after)}`}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {t.error && <span className="hidden max-w-[300px] truncate text-[12px] text-bad md:inline" title={t.error}>{t.error}</span>}
                      <Badge tone={TONE[t.status]}>{t.status === "waiting_user" ? "needs you" : t.status}</Badge>
                    </span>
                  </button>
                  {open === t.id && (
                    <div className="space-y-2 border-t border-line bg-subtle/50 px-3.5 py-3">
                      <div className="flex gap-2">
                        {["pending", "running", "waiting_user"].includes(t.status) && <Button size="sm" icon={<X className="size-3.5" />} onClick={() => run("c", () => post(`/api/agent/tasks/${t.id}`, { action: "cancel" }), "Cancelled").then(() => reload())}>Cancel</Button>}
                        {["failed", "cancelled", "waiting_user"].includes(t.status) && <Button size="sm" icon={<RotateCw className="size-3.5" />} onClick={() => run("r", () => post(`/api/agent/tasks/${t.id}`, { action: "retry" }), "Re-queued").then(() => reload())}>Retry</Button>}
                        {t.job_id && <Link href={`/jobs/${t.job_id}`}><Button size="sm" variant="ghost">Open job</Button></Link>}
                      </div>
                      <pre className="scroll-thin max-h-72 overflow-auto rounded-md border border-line bg-elev p-2.5 font-mono text-[11.5px] leading-relaxed">
                        {t.logs.length ? t.logs.map((l) => `${fmtDate(l.at, true)}  ${l.msg}`).join("\n") : "No log lines."}
                        {t.result ? `\n\nresult: ${JSON.stringify(t.result, null, 2).slice(0, 3000)}` : ""}
                      </pre>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        ) : (
          <Empty title="No tasks">Run a search or process the queue.</Empty>
        )
      ) : data.events.length ? (
        <Panel bodyClass="p-0">
          <ol className="relative divide-y divide-line">
            {data.events.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 px-3.5 py-2.5 text-[13px]">
                <span className="flex items-start gap-2">
                  <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", /fail|error|stop/.test(e.kind) ? "bg-bad" : /excluded|duplicate/.test(e.kind) ? "bg-warn" : "bg-accent")} />
                  <span>{e.message}{"job_id" in e.data && e.data.job_id ? <Link href={`/jobs/${e.data.job_id}`} className="ml-1.5 text-[12px] text-accent">open →</Link> : null}</span>
                </span>
                <span className="shrink-0 text-[11.5px] text-faint" title={fmtDate(e.created_at, true)}>{timeAgo(e.created_at)}</span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : (
        <Empty title="No activity yet" />
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-elev px-3 py-2.5">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="mt-0.5 text-[18px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}
