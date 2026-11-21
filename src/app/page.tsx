"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { ArrowRight, Bot, ChevronRight, Play, RefreshCw, Zap } from "lucide-react";
import { post, timeAgo, useApi, usePoll, fmtDate } from "@/lib/client";
import type { JobRow } from "@/lib/types";
import { Badge, Button, Empty, ErrorNote, Loading, PageHeader, Panel, Stat, cn, useAction } from "@/components/ui";
import { JobCard } from "@/components/jobs";
import { useMe } from "@/components/shell";

interface Dash {
  stats: Record<string, number | null>;
  pipeline: { key: string; label: string; count: number }[];
  recommended: JobRow[];
  agent: { tasks: { id: string; task_type: string; status: string; created_at: string; error: string | null; jobs: { title: string; company: string } | null }[] };
  activity: { id: string; kind: string; message: string; created_at: string }[];
  daily: { jobs_found: number; matches: number; applications: number; responses: number; actions_required: number; actions: { label: string; href: string }[] };
  followups: { id: string; due_at: string; type: string; note: string | null; applications: { job_id: string; jobs: { title: string; company: string } } }[];
  has_profile: boolean;
}

export default function Dashboard() {
  const { data, error, loading, reload } = useApi<Dash>("/api/dashboard");
  const silent = useCallback(() => reload(true), [reload]);
  usePoll(silent, 15000);
  const { me, refresh } = useMe();
  const { busy, run } = useAction();
  const router = useRouter();
  const [stage, setStage] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return null;
  const s = data.stats;
  const pctFmt = (v: number | null) => (v == null ? "—" : `${v}%`);
  return (
    <div className="space-y-5">
      <PageHeader
        title={`Good ${greeting()}${me?.profile_name ? `, ${me.profile_name.split(" ")[0]}` : ""}`}
        subtitle={`${data.daily.jobs_found} jobs found today · ${data.daily.actions_required} action${data.daily.actions_required === 1 ? "" : "s"} need you`}
        actions={
          <>
            <Button icon={<RefreshCw className={cn("size-3.5", busy === "search" && "animate-spin")} />} loading={busy === "search"} onClick={() => run("search", () => post<{ processed: { status: string }[] }>("/api/agent", { action: "search_now" }), "Search finished — see activity").then(() => { reload(); refresh(); })}>
              Search now
            </Button>
            <Button variant="primary" icon={<Play className="size-3.5" />} loading={busy === "run"} onClick={() => run("run", () => post<{ processed: unknown[] }>("/api/agent", { action: "run_now" }), (r) => `Agent processed ${r.processed.length} task(s)`).then(() => { reload(); refresh(); })}>
              Run agent
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Jobs discovered" value={s.total_jobs} sub={`${s.new_today} new today`} onClick={() => router.push("/discover")} />
        <Stat label="Matching profile" value={s.matching} onClick={() => router.push("/matches")} />
        <Stat label="Shortlisted" value={s.shortlisted} onClick={() => router.push("/shortlist")} />
        <Stat label="Awaiting approval" value={s.awaiting_approval} tone={s.awaiting_approval ? "warn" : undefined} onClick={() => router.push("/queue")} />
        <Stat label="Applications" value={s.applied} sub={`${s.pending} pending`} onClick={() => router.push("/applications")} />
        <Stat label="Interviews" value={s.interviews} sub={`${s.interviews_scheduled} scheduled · ${s.assessments} assessments`} onClick={() => router.push("/interviews")} />
        <Stat label="Offers / Rejections" value={`${s.offers} / ${s.rejections}`} sub={`Response ${pctFmt(s.response_rate)} · Success ${pctFmt(s.success_rate)}`} onClick={() => router.push("/analytics")} />
      </div>

      <Panel title="Pipeline" actions={stage && <Button size="sm" variant="ghost" onClick={() => setStage(null)}>Close</Button>}>
        <div className="flex flex-wrap items-stretch gap-1">
          {data.pipeline.map((p, i) => (
            <div key={p.key} className="flex items-center">
              <button onClick={() => setStage(stage === p.key ? null : p.key)} className={cn("min-w-[104px] rounded-md border px-3 py-2 text-left transition-colors", stage === p.key ? "border-accent bg-accent-soft" : "border-line hover:bg-subtle")}>
                <div className="text-[11.5px] text-muted">{p.label}</div>
                <div className="text-[18px] font-semibold tabular-nums">{p.count}</div>
              </button>
              {i < data.pipeline.length - 1 && <ChevronRight className="mx-0.5 size-3.5 text-faint" />}
            </div>
          ))}
        </div>
        {stage && <StageList stage={stage} />}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel title="Recommended jobs" actions={<Link href="/matches" className="text-[12.5px] text-muted hover:text-fg">All matches →</Link>} bodyClass="space-y-2">
            {!data.has_profile ? (
              <Empty title="Upload your resume to get recommendations" action={<Link href="/resume"><Button variant="primary">Open Resume Studio</Button></Link>} />
            ) : data.recommended.length ? (
              data.recommended.map((j) => <JobCard key={j.id} job={j} onChanged={reload} compact />)
            ) : (
              <Empty title="No strong matches from the last 7 days">Run a search or adjust saved searches in Discover Jobs.</Empty>
            )}
          </Panel>
          <Panel title="Recent activity" actions={<Link href="/activity" className="text-[12.5px] text-muted hover:text-fg">Full log →</Link>} bodyClass="p-0">
            {data.activity.length ? (
              <ul className="divide-y divide-line">
                {data.activity.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 px-3.5 py-2 text-[13px]">
                    <span>{a.message}</span>
                    <span className="shrink-0 text-[11.5px] text-faint">{timeAgo(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-muted">No activity yet. Upload a resume and run a search.</p>
            )}
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Today">
            <dl className="grid grid-cols-2 gap-3 text-[13px]">
              <Mini label="Jobs found" v={data.daily.jobs_found} />
              <Mini label="New matches" v={data.daily.matches} />
              <Mini label="Applications" v={data.daily.applications} />
              <Mini label="Responses" v={data.daily.responses} />
            </dl>
            <div className="mt-3 space-y-1.5 border-t border-line pt-3">
              <div className="text-[12px] font-semibold text-muted">Actions required ({data.daily.actions_required})</div>
              {data.daily.actions.length ? (
                data.daily.actions.map((a) => (
                  <Link key={a.label} href={a.href} className="flex items-center justify-between rounded-md px-2 py-1.5 text-[13px] hover:bg-subtle">
                    {a.label}
                    <ArrowRight className="size-3.5 text-faint" />
                  </Link>
                ))
              ) : (
                <p className="text-[12.5px] text-faint">Nothing needs you right now.</p>
              )}
            </div>
          </Panel>
          <Panel title={<span className="flex items-center gap-1.5"><Bot className="size-4 text-accent" /> Agent</span>} actions={<Badge tone={me?.agent_state === "running" ? "ok" : me?.agent_state === "paused" ? "warn" : "bad"}>{me?.agent_state ?? "…"}</Badge>} bodyClass="p-0">
            {data.agent.tasks.length ? (
              <ul className="divide-y divide-line">
                {data.agent.tasks.slice(0, 8).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 px-3.5 py-2 text-[12.5px]">
                    <span className="truncate">
                      <span className="capitalize">{t.task_type.replace(/_/g, " ")}</span>
                      {t.jobs && <span className="text-muted"> · {t.jobs.company}</span>}
                    </span>
                    <Badge tone={t.status === "running" ? "info" : t.status === "waiting_user" ? "warn" : "neutral"}>{t.status === "waiting_user" ? "needs you" : t.status}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-2 p-3.5 text-[12.5px] text-muted"><Zap className="size-3.5" /> Idle — no queued tasks.</p>
            )}
          </Panel>
          <Panel title="Follow-ups" bodyClass="p-0">
            {data.followups.length ? (
              <ul className="divide-y divide-line">
                {data.followups.map((f) => (
                  <li key={f.id}>
                    <Link href={`/jobs/${f.applications.job_id}`} className="flex items-center justify-between gap-2 px-3.5 py-2 text-[12.5px] hover:bg-subtle">
                      <span className="truncate">{f.applications.jobs.title} — {f.applications.jobs.company}</span>
                      <span className={cn("shrink-0", new Date(f.due_at) <= new Date() ? "text-warn" : "text-faint")}>{fmtDate(f.due_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-3.5 text-[12.5px] text-muted">No follow-ups scheduled. Set a follow-up date on any application.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Mini({ label, v }: { label: string; v: number }) {
  return (
    <div>
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd className="text-[18px] font-semibold tabular-nums">{v}</dd>
    </div>
  );
}

function StageList({ stage }: { stage: string }) {
  const { data, loading, error, reload } = useApi<{ jobs: JobRow[]; total: number }>(`/api/jobs?view=stage&stage=${stage}&sort=score&limit=30`);
  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      <p className="text-[12px] text-muted">{data?.total ?? 0} records</p>
      {data?.jobs.length ? data.jobs.map((j) => <JobCard key={j.id} job={j} onChanged={reload} compact />) : <p className="text-muted">Nothing in this stage.</p>}
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}
