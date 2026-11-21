"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bookmark, Building2, Clock, ExternalLink, EyeOff, Eye, FileText, Globe, Mail, MapPin, Send, Sparkles, Star, Wand2 } from "lucide-react";
import type { JobRow, MatchAnalysis } from "@/lib/types";
import { STATUS_LABEL, type ApplicationStatus } from "@/lib/types";
import { fmtSalary, patch, post, timeAgo } from "@/lib/client";
import { Badge, Bar, Button, cn, IconButton, Score, recTone, useAction } from "./ui";

export function statusTone(s?: ApplicationStatus | null) {
  if (!s) return "neutral" as const;
  if (["offer"].includes(s)) return "ok" as const;
  if (["interview", "assessment", "recruiter_contacted"].includes(s)) return "info" as const;
  if (["applied", "application_confirmed"].includes(s)) return "accent" as const;
  if (["awaiting_approval", "ready_to_apply", "resume_generated"].includes(s)) return "warn" as const;
  if (["rejected", "withdrawn", "expired"].includes(s)) return "bad" as const;
  return "neutral" as const;
}

export function StatusBadge({ status }: { status?: ApplicationStatus | null }) {
  if (!status) return null;
  return <Badge tone={statusTone(status)}>{STATUS_LABEL[status]}</Badge>;
}

const SOURCE_LABEL: Record<string, string> = {
  remoteok: "Remote OK", remotive: "Remotive", weworkremotely: "We Work Remotely", himalayas: "Himalayas", arbeitnow: "Arbeitnow",
  greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday", linkedin: "LinkedIn", naukri: "Naukri", indeed: "Indeed",
  foundit: "Foundit", glassdoor: "Glassdoor", wellfound: "Wellfound", manual: "Manual", extension: "Extension",
};
export const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s;

export function CompanyLogo({ job, size = 32 }: { job: Pick<JobRow, "company" | "company_logo">; size?: number }) {
  const [err, setErr] = useState(false);
  if (job.company_logo && !err)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={job.company_logo} alt="" width={size} height={size} onError={() => setErr(true)} className="shrink-0 rounded-md border border-line bg-white object-contain" style={{ width: size, height: size }} />;
  return (
    <div className="flex shrink-0 items-center justify-center rounded-md border border-line bg-subtle text-[12px] font-semibold text-muted" style={{ width: size, height: size }}>
      {job.company.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function JobMeta({ job }: { job: JobRow }) {
  const sal = fmtSalary(job);
  const exp = job.experience_min != null ? `${job.experience_min}${job.experience_max != null ? `–${job.experience_max}` : "+"} yrs` : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
      <span className="inline-flex items-center gap-1"><Building2 className="size-3" />{job.company}</span>
      {job.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{job.location}</span>}
      {job.remote_type && job.remote_type !== "unknown" && <Badge tone={job.remote_type === "remote" ? "ok" : "neutral"}>{job.remote_type}</Badge>}
      {job.job_type && <span className="capitalize">{job.job_type}</span>}
      {sal && <span className="font-medium text-fg">{sal}</span>}
      {exp && <span>{exp}</span>}
      <span className="inline-flex items-center gap-1"><Clock className="size-3" />{timeAgo(job.posted_at ?? job.discovered_at)}</span>
    </div>
  );
}

export function JobCard({ job, onChanged, selected, onSelect, compact }: { job: JobRow; onChanged?: () => void; selected?: boolean; onSelect?: (id: string, v: boolean) => void; compact?: boolean }) {
  const router = useRouter();
  const { busy, run } = useAction();
  const m = job.match_analysis as MatchAnalysis | null;
  const status = job.application?.application_status;
  const act = (key: string, fn: () => Promise<unknown>, msg: string) => run(key, fn, msg).then(() => onChanged?.());
  const sources = (job.sources ?? []).filter((s, i, arr) => arr.findIndex((x) => x.source_name === s.source_name) === i);
  return (
    <article className={cn("group rounded-lg border bg-elev p-3 transition-colors hover:border-line-strong", selected ? "border-accent" : "border-line")}>
      <div className="flex gap-3">
        {onSelect && <input type="checkbox" aria-label="Select job" checked={!!selected} onChange={(e) => onSelect(job.id, e.target.checked)} className="mt-2 size-3.5 accent-[var(--accent)]" />}
        <CompanyLogo job={job} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/jobs/${job.id}`} className="block truncate text-[14px] font-semibold hover:text-accent">{job.title}</Link>
              <JobMeta job={job} />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {m?.recommendation && <Badge tone={recTone(m.recommendation)}>{m.recommendation}</Badge>}
              <Score value={job.match_score} />
            </div>
          </div>
          {!compact && job.description && <p className="mt-2 line-clamp-2 text-[12.5px] text-muted">{job.description.replace(/\s+/g, " ").slice(0, 320)}</p>}
          {!compact && m && (m.why_match.length > 0 || m.risks.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {m.matched_skills.slice(0, 5).map((s) => <Badge key={s} tone="ok">{s}</Badge>)}
              {m.risks.slice(0, 2).map((r) => <Badge key={r} tone="warn" title={r}>{r.length > 48 ? r.slice(0, 46) + "…" : r}</Badge>)}
            </div>
          )}
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={status} />
              {sources.map((s) => (
                <a key={s.source_name + s.source_url} href={s.source_url ?? "#"} target="_blank" rel="noreferrer" className="text-[11.5px] text-faint hover:text-fg" title={`Open on ${sourceLabel(s.source_name)}`}>
                  {sourceLabel(s.source_name)} ↗
                </a>
              ))}
              {!sources.length && <span className="text-[11.5px] text-faint">{sourceLabel(job.source)}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-0.5 opacity-80 group-hover:opacity-100">
              <Button size="sm" variant="ghost" onClick={() => router.push(`/jobs/${job.id}`)}>View</Button>
              <IconButton label="Save" disabled={!!busy} onClick={() => act("save", () => patch(`/api/jobs/${job.id}`, { action: "save" }), "Saved")}><Bookmark className="size-3.5" /></IconButton>
              <IconButton label={status === "shortlisted" ? "Remove from shortlist" : "Shortlist"} disabled={!!busy} onClick={() => act("short", () => patch(`/api/jobs/${job.id}`, { action: status === "shortlisted" ? "unshortlist" : "shortlist" }), status === "shortlisted" ? "Removed from shortlist" : "Shortlisted")}>
                <Star className={cn("size-3.5", status === "shortlisted" && "fill-[var(--warn)] text-warn")} />
              </IconButton>
              <IconButton label={job.hidden ? "Unhide" : "Hide"} disabled={!!busy} onClick={() => act("hide", () => patch(`/api/jobs/${job.id}`, { action: job.hidden ? "unhide" : "hide" }), job.hidden ? "Restored" : "Hidden")}>
                {job.hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              </IconButton>
              <IconButton label="Analyze" disabled={!!busy} onClick={() => act("an", () => post(`/api/jobs/${job.id}/analyze`), "Analysis updated")}><Sparkles className={cn("size-3.5", busy === "an" && "animate-pulse")} /></IconButton>
              <IconButton label="Tailor resume" disabled={!!busy} onClick={() => run("tl", () => post<{ id: string }>(`/api/jobs/${job.id}/tailor`), "Tailored resume created").then((r) => r && router.push(`/resume/versions/${r.id}`))}><Wand2 className={cn("size-3.5", busy === "tl" && "animate-pulse")} /></IconButton>
              <IconButton label="Generate cover letter" disabled={!!busy} onClick={() => run("cl", () => post(`/api/jobs/${job.id}/letters`, { kind: "cover_letter" }), "Cover letter generated").then((r) => r && router.push(`/jobs/${job.id}?tab=letters`))}><Mail className={cn("size-3.5", busy === "cl" && "animate-pulse")} /></IconButton>
              <IconButton label="Apply (prepare application)" disabled={!!busy} onClick={() => run("ap", () => post<{ route: string; reason?: string }>(`/api/jobs/${job.id}/prepare`), (r) => (r.route === "manual" ? `Package ready — ${r.reason ?? "apply manually"}` : r.route === "already_applied" ? r.reason ?? "Already applied" : `Queued (${r.route})`)).then(() => onChanged?.())}><Send className="size-3.5" /></IconButton>
              <IconButton label="Open in Browser Workspace" onClick={() => router.push(`/browser?job=${job.id}`)}><Globe className="size-3.5" /></IconButton>
              {(job.apply_url || job.source_url) && (
                <a href={job.apply_url ?? job.source_url ?? "#"} target="_blank" rel="noreferrer" title="Open original posting" className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-fg">
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export function MatchBreakdown({ m }: { m: MatchAnalysis }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-x-5 gap-y-2.5 sm:grid-cols-3">
        <Bar label="Skills" value={m.display.skills} />
        <Bar label="Experience" value={m.display.experience} />
        <Bar label="Education" value={m.display.education} />
        <Bar label="Location" value={m.display.location} />
        <Bar label="Salary" value={m.display.salary} />
        <Bar label="Job preference" value={m.display.preference} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <ListBlock title="Why you match" items={m.why_match} tone="ok" />
        <ListBlock title="Relevant strengths" items={m.strengths} tone="ok" />
        <ListBlock title="Missing qualifications" items={m.missing_qualifications} tone="warn" />
        <ListBlock title="Risk factors" items={m.risks} tone="bad" />
      </div>
      <p className="text-[12px] text-faint">Experience: role asks {m.required_years != null ? `${m.required_years}+ yrs` : "unspecified"}; your profile shows ~{m.candidate_years} yrs (internships count half). Scores are computed by a transparent rule engine using your configurable weights.</p>
    </div>
  );
}

function ListBlock({ title, items, tone }: { title: string; items: string[]; tone: "ok" | "warn" | "bad" }) {
  return (
    <div>
      <h4 className="mb-1 text-[12px] font-semibold text-muted">{title}</h4>
      {items.length ? (
        <ul className="space-y-1 text-[13px]">
          {items.map((i) => (
            <li key={i} className="flex gap-2">
              <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : "bg-bad")} />
              <span>{i}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-faint">None found.</p>
      )}
    </div>
  );
}

export function SourceIcon() {
  return <FileText className="size-3.5" />;
}
