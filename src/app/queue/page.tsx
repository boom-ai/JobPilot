"use client";
import Link from "next/link";
import { useCallback } from "react";
import { Bot, ExternalLink, Laptop, Send } from "lucide-react";
import { post, timeAgo, useApi, usePoll } from "@/lib/client";
import type { ApplicationStatus } from "@/lib/types";
import { Badge, Button, Empty, ErrorNote, Loading, PageHeader, Panel, Score, useAction } from "@/components/ui";
import { ApprovalBox } from "@/components/approval";
import { StatusBadge } from "@/components/jobs";
import { useMe } from "@/components/shell";

interface App {
  id: string;
  job_id: string;
  application_status: ApplicationStatus;
  mode: string | null;
  review_data: Record<string, unknown> | null;
  updated_at: string;
  status_history: { note: string | null }[];
  jobs: { id: string; title: string; company: string; match_score: number | null; apply_url: string | null; source_url: string | null; source: string } | null;
}
interface Task {
  id: string;
  task_type: string;
  status: string;
  error: string | null;
  job_id: string | null;
  created_at: string;
  requires_browser: boolean;
  jobs: { title: string; company: string } | null;
}

export default function QueuePage() {
  const apps = useApi<{ applications: App[] }>("/api/applications");
  const agent = useApi<{ tasks: Task[]; state: string }>("/api/agent?limit=150");
  const ra = apps.reload;
  const rg = agent.reload;
  const silent = useCallback(() => { ra(true); rg(true); }, [ra, rg]);
  usePoll(silent, 10000);
  const { me } = useMe();
  const { busy, run } = useAction();
  if ((apps.loading && !apps.data) || (agent.loading && !agent.data)) return <Loading />;
  if (apps.error) return <ErrorNote error={apps.error} />;
  const all = apps.data?.applications ?? [];
  const awaiting = all.filter((a) => a.application_status === "awaiting_approval");
  const ready = all.filter((a) => ["ready_to_apply", "resume_generated"].includes(a.application_status));
  const browserTasks = (agent.data?.tasks ?? []).filter((t) => t.task_type === "application_submission" && ["pending", "running", "waiting_user"].includes(t.status));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Application Queue"
        subtitle="Jobs prepared by the agent. 90+ can auto-submit where permitted, 80–89 wait for your approval, below 80 are never applied to automatically."
        actions={<Link href="/settings?tab=automation"><Button>Automation settings</Button></Link>}
      />
      <Panel title={<span className="flex items-center gap-2">Awaiting your approval <Badge tone="warn">{awaiting.length}</Badge></span>}>
        {awaiting.length ? (
          <div className="space-y-3">
            {awaiting.map((a) => (
              <div key={a.id} className="rounded-lg border border-line p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <Link href={`/jobs/${a.job_id}?tab=apply`} className="font-semibold hover:text-accent">{a.jobs?.title} — {a.jobs?.company}</Link>
                  <Score value={a.jobs?.match_score ?? null} size="sm" />
                </div>
                <ApprovalBox app={a} reload={() => apps.reload()} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted">Nothing awaiting approval. Assisted fills appear here after the browser worker completes a form.</p>
        )}
      </Panel>
      <Panel title={<span className="flex items-center gap-2"><Laptop className="size-4" /> Browser worker queue <Badge>{browserTasks.length}</Badge></span>}>
        <p className="mb-2 text-[12.5px] text-muted">
          Form filling and submission run in the local browser worker (<code className="rounded bg-subtle px-1">npm run worker</code> on your computer) so you can see the browser and step in for CAPTCHA or MFA. {me?.agent_state !== "running" && <b className="text-warn">The agent is {me?.agent_state} — the worker won&apos;t pick up tasks.</b>}
        </p>
        {browserTasks.length ? (
          <ul className="divide-y divide-line">
            {browserTasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                <span>{t.jobs ? `${t.jobs.title} — ${t.jobs.company}` : "Job"} <span className="text-faint">· queued {timeAgo(t.created_at)}</span></span>
                <span className="flex items-center gap-2">
                  {t.error && <span className="max-w-[320px] truncate text-[12px] text-warn" title={t.error}>{t.error}</span>}
                  <Badge tone={t.status === "waiting_user" ? "warn" : t.status === "running" ? "info" : "neutral"}>{t.status === "waiting_user" ? "needs you" : t.status}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => run("c" + t.id, () => post(`/api/agent/tasks/${t.id}`, { action: "cancel" }), "Cancelled").then(() => agent.reload())}>Cancel</Button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">No pending browser tasks.</p>
        )}
      </Panel>
      <Panel title={<span className="flex items-center gap-2">Ready to apply <Badge>{ready.length}</Badge></span>} bodyClass="p-0">
        {ready.length ? (
          <ul className="divide-y divide-line">
            {ready.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="min-w-0">
                  <Link href={`/jobs/${a.job_id}?tab=apply`} className="font-medium hover:text-accent">{a.jobs?.title} — {a.jobs?.company}</Link>
                  <div className="text-[12px] text-muted">{a.status_history.at(-1)?.note ?? "Package prepared"} · {timeAgo(a.updated_at)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Score value={a.jobs?.match_score ?? null} size="sm" />
                  <StatusBadge status={a.application_status} />
                  <Button size="sm" icon={<Send className="size-3.5" />} loading={busy === a.id} onClick={() => run(a.id, () => post<{ route: string; reason?: string }>(`/api/jobs/${a.job_id}/prepare`), (r) => (r.route === "manual" ? r.reason ?? "Ready — apply via the site" : `Queued (${r.route})`)).then(() => { apps.reload(); agent.reload(); })}>Prepare / queue</Button>
                  {(a.jobs?.apply_url || a.jobs?.source_url) && <a href={a.jobs.apply_url ?? a.jobs.source_url ?? "#"} target="_blank" rel="noreferrer"><Button size="sm" icon={<ExternalLink className="size-3.5" />}>Apply</Button></a>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-4"><Empty icon={<Bot className="size-6" />} title="Queue is empty">Tailor a resume or click “Apply” on a job to prepare its package.</Empty></div>
        )}
      </Panel>
    </div>
  );
}
