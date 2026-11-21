"use client";
import { useState } from "react";
import { Copy, Pencil, Play, RotateCw, Save, Trash2 } from "lucide-react";
import type { JobFilters, JobType, RemoteType } from "@/lib/types";
import { Button, Checkbox, Field, IconButton, Input, Modal, Select, TagInput, cn, useAction, Badge } from "./ui";
import { del, patch, post, timeAgo } from "@/lib/client";

export interface SavedSearch {
  id: string;
  name: string;
  query: { keywords?: string; roles?: string[]; locations?: string[]; exclude?: string[] };
  filters: JobFilters;
  sources: string[];
  schedule: string;
  cron: string | null;
  enabled: boolean;
  is_preset: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
}

const REMOTE: { v: RemoteType; l: string }[] = [
  { v: "remote", l: "Remote" },
  { v: "hybrid", l: "Hybrid" },
  { v: "onsite", l: "On-site" },
];
const TYPES: { v: JobType; l: string }[] = [
  { v: "full-time", l: "Full-time" },
  { v: "part-time", l: "Part-time" },
  { v: "contract", l: "Contract" },
  { v: "freelance", l: "Freelance" },
  { v: "internship", l: "Internship" },
  { v: "temporary", l: "Temporary" },
];
const EXP: { l: string; min: number | null; max: number | null }[] = [
  { l: "Any", min: null, max: null },
  { l: "Fresher / entry", min: 0, max: 1 },
  { l: "0–1 yrs", min: 0, max: 1 },
  { l: "1–2 yrs", min: 1, max: 2 },
  { l: "1–3 yrs", min: 1, max: 3 },
  { l: "3–5 yrs", min: 3, max: 5 },
  { l: "5+ yrs", min: 5, max: 40 },
];
const CITIES = ["India", "Remote", "Bengaluru", "Hyderabad", "Pune", "Mumbai", "Delhi", "Gurugram", "Noida", "Chennai", "Chandigarh", "Mohali", "Jalandhar", "Kolkata"];

function toggle<T>(arr: T[] | undefined, v: T): T[] {
  const a = arr ?? [];
  return a.includes(v) ? a.filter((x) => x !== v) : [...a, v];
}

export function countActive(f: JobFilters): number {
  return Object.entries(f).filter(([k, v]) => k !== "hide_duplicates" && v != null && v !== false && v !== "" && !(Array.isArray(v) && !v.length) && !(typeof v === "object" && !Array.isArray(v) && (v as { min?: unknown; max?: unknown }).min == null && (v as { max?: unknown }).max == null)).length;
}

export function FilterPanel({ value, onChange, onReset }: { value: JobFilters; onChange: (f: JobFilters) => void; onReset: () => void }) {
  const f = value;
  const set = (p: Partial<JobFilters>) => onChange({ ...f, ...p });
  const expSel = EXP.findIndex((e) => e.min === (f.experience?.min ?? null) && e.max === (f.experience?.max ?? null));
  return (
    <div className="space-y-4">
      <Group title="Location">
        <div className="flex flex-wrap gap-1">
          {REMOTE.map((r) => (
            <Chip key={r.v} on={!!f.remote_types?.includes(r.v)} onClick={() => set({ remote_types: toggle(f.remote_types, r.v) })}>{r.l}</Chip>
          ))}
        </div>
        <TagInput value={f.locations ?? []} onChange={(v) => set({ locations: v })} placeholder="Cities / countries (Enter)…" />
        <div className="flex flex-wrap gap-1">
          {CITIES.filter((c) => !(f.locations ?? []).includes(c)).slice(0, 8).map((c) => (
            <button key={c} onClick={() => set({ locations: [...(f.locations ?? []), c] })} className="rounded border border-dashed border-line px-1.5 text-[11.5px] text-faint hover:text-fg">+ {c}</button>
          ))}
        </div>
        <Checkbox checked={!!f.international_remote} onChange={(v) => set({ international_remote: v })} label="International remote (open to India / worldwide)" />
        <Checkbox checked={!!f.countries?.includes("India")} onChange={(v) => set({ countries: v ? ["India"] : [] })} label="India only" />
      </Group>
      <Group title="Employment type">
        <div className="flex flex-wrap gap-1">
          {TYPES.map((t) => (
            <Chip key={t.v} on={!!f.job_types?.includes(t.v)} onClick={() => set({ job_types: toggle(f.job_types, t.v) })}>{t.l}</Chip>
          ))}
        </div>
      </Group>
      <Group title="Salary">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Min (LPA)"><Input type="number" min={0} step={0.5} value={f.salary_min_lpa ?? ""} onChange={(e) => set({ salary_min_lpa: e.target.value ? Number(e.target.value) : null })} /></Field>
          <Field label="Max (LPA)"><Input type="number" min={0} step={0.5} value={f.salary_max_lpa ?? ""} onChange={(e) => set({ salary_max_lpa: e.target.value ? Number(e.target.value) : null })} /></Field>
        </div>
        <Field label="International min (USD / year)"><Input type="number" min={0} step={1000} value={f.salary_min_usd ?? ""} onChange={(e) => set({ salary_min_usd: e.target.value ? Number(e.target.value) : null })} /></Field>
        <Checkbox checked={f.include_undisclosed_salary !== false} onChange={(v) => set({ include_undisclosed_salary: v })} label="Include undisclosed salary" />
      </Group>
      <Group title="Experience required">
        <Select value={expSel < 0 ? "custom" : String(expSel)} onChange={(e) => { const e2 = EXP[Number(e.target.value)]; if (e2) set({ experience: { min: e2.min, max: e2.max }, fresher_ok: e2.l.startsWith("Fresher") }); }}>
          {EXP.map((e, i) => <option key={e.l} value={i}>{e.l}</option>)}
          {expSel < 0 && <option value="custom">Custom</option>}
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <Input type="number" min={0} placeholder="Custom min" value={f.experience?.min ?? ""} onChange={(e) => set({ experience: { ...f.experience, min: e.target.value === "" ? null : Number(e.target.value) } })} />
          <Input type="number" min={0} placeholder="Custom max" value={f.experience?.max ?? ""} onChange={(e) => set({ experience: { ...f.experience, max: e.target.value === "" ? null : Number(e.target.value) } })} />
        </div>
      </Group>
      <Group title="Role & skills">
        <TagInput value={f.roles ?? []} onChange={(v) => set({ roles: v })} placeholder="Job roles (Enter)…" />
        <TagInput value={f.skills ?? []} onChange={(v) => set({ skills: v })} placeholder="Skills (Enter)…" />
        <TagInput value={f.industries ?? []} onChange={(v) => set({ industries: v })} placeholder="Industries (Enter)…" />
      </Group>
      <Group title="Role characteristics">
        <Checkbox checked={!!f.ai_related} onChange={(v) => set({ ai_related: v })} label="AI-related" />
        <Checkbox checked={!!f.non_coding} onChange={(v) => set({ non_coding: v })} label="Non-coding" />
        <Checkbox checked={!!f.non_technical} onChange={(v) => set({ non_technical: v })} label="Non-technical title" />
        <Checkbox checked={!!f.fresher_ok} onChange={(v) => set({ fresher_ok: v })} label="No experience required / exclude senior titles" />
        <Checkbox checked={!!f.degree_not_required} onChange={(v) => set({ degree_not_required: v })} label="No degree requirement" />
        <Checkbox checked={!!f.visa_sponsorship} onChange={(v) => set({ visa_sponsorship: v })} label="Visa sponsorship mentioned" />
        <Checkbox checked={!!f.easy_apply} onChange={(v) => set({ easy_apply: v })} label="Easy Apply (where source reports it)" />
      </Group>
      <Group title="Posting">
        <Field label="Date posted">
          <Select value={f.posted_within_days ?? ""} onChange={(e) => set({ posted_within_days: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Any time</option>
            <option value="1">Last 24 hours</option>
            <option value="3">Last 3 days</option>
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30">Last 30 days</option>
          </Select>
        </Field>
        <Field label="Minimum match score"><Input type="number" min={0} max={100} value={f.min_score ?? ""} onChange={(e) => set({ min_score: e.target.value ? Number(e.target.value) : null })} /></Field>
        <Field label="Deadline on/after"><Input type="date" value={f.deadline_after ?? ""} onChange={(e) => set({ deadline_after: e.target.value || null })} /></Field>
        <Field label="Company size">
          <TagInput value={f.company_sizes ?? []} onChange={(v) => set({ company_sizes: v })} placeholder="e.g. 11-50, 201-500" />
        </Field>
      </Group>
      <Group title="Exclude">
        <TagInput value={f.exclude_companies ?? []} onChange={(v) => set({ exclude_companies: v })} placeholder="Companies to exclude…" />
        <TagInput value={f.exclude_keywords ?? []} onChange={(v) => set({ exclude_keywords: v })} placeholder="Keywords to exclude…" />
        <Checkbox checked={!!f.hide_applied} onChange={(v) => set({ hide_applied: v })} label="Hide already applied" />
        <Checkbox checked={!!f.hide_rejected} onChange={(v) => set({ hide_rejected: v })} label="Hide previously rejected" />
        <Checkbox checked={f.hide_duplicates !== false} onChange={(v) => set({ hide_duplicates: v })} label="Hide merged duplicates" />
      </Group>
      <Button variant="ghost" className="w-full" icon={<RotateCw className="size-3.5" />} onClick={onReset}>Reset filters</Button>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-faint">{title}</legend>
      {children}
    </fieldset>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("h-6 rounded-md border px-2 text-[12px] transition-colors", on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg")}>
      {children}
    </button>
  );
}

const SCHEDULE_LABEL: Record<string, string> = { manual: "Manual", "6h": "Every 6h", "12h": "Every 12h", daily: "Daily", weekly: "Weekly", custom: "Custom" };

export function PresetBar({ searches, active, onApply, onChanged, currentFilters, currentQuery }: {
  searches: SavedSearch[];
  active: string | null;
  onApply: (s: SavedSearch) => void;
  onChanged: () => void;
  currentFilters: JobFilters;
  currentQuery: string;
}) {
  const { busy, run } = useAction();
  const [edit, setEdit] = useState<SavedSearch | "new" | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {searches.map((s) => (
        <div key={s.id} className={cn("group inline-flex h-7 items-center rounded-md border text-[12.5px]", active === s.id ? "border-accent bg-accent-soft text-accent" : "border-line text-muted")}>
          <button onClick={() => onApply(s)} className="px-2 hover:text-fg" title={`Apply “${s.name}” filters${s.last_run_at ? ` · last run ${timeAgo(s.last_run_at)}` : ""}`}>
            {s.name}
            {s.schedule !== "manual" && s.enabled && <span className="ml-1 text-faint">· {SCHEDULE_LABEL[s.schedule]}</span>}
          </button>
          <span className="hidden items-center pr-0.5 group-hover:inline-flex">
            <IconButton label={`Run “${s.name}” now`} className="size-6" disabled={!!busy} onClick={() => run(`run${s.id}`, () => post<{ task: { result?: { inserted?: number } } }>(`/api/searches/${s.id}/run`), (r) => `“${s.name}”: ${r.task?.result?.inserted ?? 0} new jobs`).then(onChanged)}>
              <Play className={cn("size-3", busy === `run${s.id}` && "animate-pulse")} />
            </IconButton>
            <IconButton label="Edit" className="size-6" onClick={() => setEdit(s)}><Pencil className="size-3" /></IconButton>
            <IconButton label="Clone" className="size-6" onClick={() => run("clone", () => post("/api/searches", { name: `${s.name} (copy)`, clone_of: s.id }), "Cloned").then(onChanged)}><Copy className="size-3" /></IconButton>
            <IconButton label="Delete" className="size-6" onClick={() => confirm(`Delete “${s.name}”?`) && run("del", () => del(`/api/searches/${s.id}`), "Deleted").then(onChanged)}><Trash2 className="size-3" /></IconButton>
          </span>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Save className="size-3.5" />} onClick={() => setEdit("new")}>Save current as preset</Button>
      {edit && (
        <SearchEditor
          initial={edit === "new" ? null : edit}
          currentFilters={currentFilters}
          currentQuery={currentQuery}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function SearchEditor({ initial, currentFilters, currentQuery, onClose, onSaved }: { initial: SavedSearch | null; currentFilters: JobFilters; currentQuery: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [keywords, setKeywords] = useState(initial?.query.keywords ?? currentQuery);
  const [roles, setRoles] = useState<string[]>(initial?.query.roles ?? []);
  const [locations, setLocations] = useState<string[]>(initial?.query.locations ?? []);
  const [exclude, setExclude] = useState<string[]>(initial?.query.exclude ?? []);
  const [schedule, setSchedule] = useState(initial?.schedule ?? "manual");
  const [cron, setCron] = useState(initial?.cron ?? "every 8h");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [useCurrent, setUseCurrent] = useState(!initial);
  const { busy, run } = useAction();
  const save = () =>
    run(
      "save",
      () => {
        const payload = { name, query: { keywords, roles, locations, exclude }, schedule, cron: schedule === "custom" ? cron : null, enabled, ...(useCurrent ? { filters: currentFilters } : {}) };
        return initial ? patch(`/api/searches/${initial.id}`, payload) : post("/api/searches", payload);
      },
      initial ? "Search updated" : "Preset saved",
    ).then((r) => r && onSaved());
  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? `Edit “${initial.name}”` : "Save search preset"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy === "save"} disabled={!name.trim()} onClick={save}>Save</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Remote LLM roles" autoFocus /></Field>
        <Field label="Keywords" hint="Comma-separated groups; jobs match any group (e.g. “LLM evaluation, annotation”)."><Input value={keywords} onChange={(e) => setKeywords(e.target.value)} /></Field>
        <Field label="Roles"><TagInput value={roles} onChange={setRoles} placeholder="Defaults to your preferred roles" /></Field>
        <Field label="Locations"><TagInput value={locations} onChange={setLocations} placeholder="Defaults to your preferred locations" /></Field>
        <Field label="Exclusion keywords"><TagInput value={exclude} onChange={setExclude} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Schedule">
            <Select value={schedule} onChange={(e) => setSchedule(e.target.value)}>
              {Object.entries(SCHEDULE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          {schedule === "custom" && <Field label="Custom interval" hint="e.g. “every 8h” or “every 90m”"><Input value={cron} onChange={(e) => setCron(e.target.value)} /></Field>}
        </div>
        <Checkbox checked={enabled} onChange={setEnabled} label="Enabled (scheduled runs active)" />
        <Checkbox checked={useCurrent} onChange={setUseCurrent} label={<span>Use the filters currently applied <Badge>{countActive(currentFilters)} active</Badge></span>} />
      </div>
    </Modal>
  );
}
