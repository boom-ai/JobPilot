// Dashboard & analytics computations — derived only from real records.
import type { ApplicationStatus } from "./types";

export const APPLIED_SET: ApplicationStatus[] = ["applied", "application_confirmed", "recruiter_contacted", "assessment", "interview", "offer", "rejected", "withdrawn"];
export const RESPONSE_SET: ApplicationStatus[] = ["recruiter_contacted", "assessment", "interview", "offer", "rejected"];

export interface AppLite {
  id: string;
  job_id: string;
  application_status: ApplicationStatus;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
  follow_up_date: string | null;
  resume_version_id: string | null;
  status_history: { from: string | null; to: string; at: string; by?: string }[];
  jobs?: { title: string; company: string; source: string; match_score: number | null } | null;
}

export function firstAt(a: AppLite, statuses: string[]): string | null {
  const h = (a.status_history ?? []).find((s) => statuses.includes(s.to));
  return h?.at ?? null;
}

export function everApplied(a: AppLite): boolean {
  return !!a.applied_at || (a.status_history ?? []).some((h) => h.to === "applied" || h.to === "application_confirmed");
}

export function everResponded(a: AppLite): boolean {
  return (a.status_history ?? []).some((h) => RESPONSE_SET.includes(h.to as ApplicationStatus) && everApplied(a));
}

export function pct(n: number, d: number): number | null {
  return d ? Math.round((n / d) * 1000) / 10 : null;
}

export function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() - day + 1);
  return t.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 864e5);
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
}

export function roleFamily(title: string): string {
  const t = title.toLowerCase();
  if (/annotat|label/.test(t)) return "Annotation";
  if (/evaluat|rater|review|assess/.test(t)) return "Evaluation / Rating";
  if (/trainer|tutor/.test(t)) return "AI Trainer";
  if (/quality|qa\b/.test(t)) return "Quality";
  if (/prompt/.test(t)) return "Prompt";
  if (/analyst/.test(t)) return "Analyst";
  if (/engineer|developer/.test(t)) return "Engineering";
  return "Other";
}
