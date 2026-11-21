"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Check, FileText, Plus, Trash2, Upload } from "lucide-react";
import type { Bullet, CareerProfile } from "@/lib/types";
import { del, patch, put, timeAgo, useApi } from "@/lib/client";
import { Badge, Button, Empty, ErrorNote, Field, IconButton, Input, Loading, PageHeader, Panel, Tabs, Textarea, cn, useAction, useToast } from "@/components/ui";
import { useMe } from "@/components/shell";

interface ResumeRow {
  id: string;
  filename: string;
  extraction_method: string;
  is_primary: boolean;
  created_at: string;
}
interface VersionRow {
  id: string;
  job_id: string;
  version: number;
  file_name: string;
  method: string;
  created_at: string;
  jobs: { title: string; company: string } | null;
}

const uid = (p: string) => p + Math.random().toString(36).slice(2, 9);

export default function ResumeStudio() {
  const [tab, setTab] = useState<"profile" | "files" | "versions">("profile");
  const prof = useApi<{ profile: CareerProfile; experience_years: number }>("/api/profile");
  const resumes = useApi<{ resumes: ResumeRow[] }>("/api/resumes");
  const versions = useApi<{ versions: VersionRow[] }>(tab === "versions" ? "/api/resume-versions" : null);
  const { refresh } = useMe();
  return (
    <div className="space-y-4">
      <PageHeader title="Resume Studio" subtitle="Your master profile is the single source of truth for scoring, tailoring, letters and answers. Nothing is ever invented beyond it." />
      <Uploader onDone={() => { prof.reload(); resumes.reload(); refresh(); }} />
      <Tabs value={tab} onChange={setTab} items={[{ value: "profile", label: "Master profile" }, { value: "files", label: "Uploaded resumes", count: resumes.data?.resumes.length }, { value: "versions", label: "Tailored versions" }]} />
      {tab === "profile" && (prof.loading && !prof.data ? <Loading /> : prof.error ? <ErrorNote error={prof.error} /> : prof.data && <ProfileEditor key={JSON.stringify(prof.data.profile).length} initial={prof.data.profile} years={prof.data.experience_years} onSaved={() => { prof.reload(); refresh(); }} />)}
      {tab === "files" && <ResumeFiles data={resumes.data?.resumes ?? []} reload={() => { resumes.reload(); prof.reload(); }} />}
      {tab === "versions" && (versions.loading ? <Loading /> : versions.data?.versions.length ? (
        <Panel bodyClass="p-0">
          <ul className="divide-y divide-line">
            {versions.data.versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="min-w-0">
                  <Link href={`/resume/versions/${v.id}`} className="font-medium hover:text-accent">{v.file_name}</Link>
                  <div className="text-[12px] text-muted">{v.jobs ? `${v.jobs.title} — ${v.jobs.company}` : "Job deleted"} · v{v.version} · {v.method === "ai" ? "AI (truth-checked)" : "rule-based"} · {timeAgo(v.created_at)}</div>
                </div>
                <Link href={`/resume/versions/${v.id}`}><Button size="sm">Open</Button></Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : <Empty title="No tailored resumes yet">Use “Tailor resume” on any job.</Empty>)}
    </div>
  );
}

function Uploader({ onDone }: { onDone: () => void }) {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ method: string; unknown_fields: string[]; dropped: string[]; ai_error: string | null } | null>(null);
  const [applyToProfile, setApply] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const upload = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (!/\.(pdf|docx)$/i.test(f.name)) {
        toast(`${f.name}: only PDF or DOCX`, "bad");
        continue;
      }
      setBusy(f.name);
      try {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("apply_to_profile", String(applyToProfile));
        const res = await fetch("/api/resumes", { method: "POST", body: fd });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error);
        setResult(j);
        toast(`${f.name} parsed (${j.method === "ai" ? "AI, verified against text" : "rule-based parser"})`);
      } catch (e) {
        toast(`${f.name}: ${(e as Error).message}`, "bad");
      }
    }
    setBusy(null);
    onDone();
  };
  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
        className={cn("flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-dashed px-4 py-4 transition-colors", drag ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong")}
      >
        <div className="flex items-center gap-3">
          <Upload className="size-5 text-muted" />
          <div>
            <p className="font-medium">{busy ? `Parsing ${busy}…` : "Drop resumes here or click to upload"}</p>
            <p className="text-[12px] text-muted">PDF or DOCX, up to 8 MB. Multiple files supported.</p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-muted" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={applyToProfile} onChange={(e) => setApply(e.target.checked)} className="accent-[var(--accent)]" />
          Replace master profile with parsed data
        </label>
        <input ref={input} type="file" accept=".pdf,.docx" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
      </div>
      {result && (result.unknown_fields.length > 0 || result.dropped.length > 0 || result.ai_error) && (
        <div className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
          {result.unknown_fields.length > 0 && <p><AlertTriangle className="mr-1 inline size-3.5" />Not found in your resume (add them in the profile below if you want them used): <b>{result.unknown_fields.join(", ")}</b></p>}
          {result.dropped.length > 0 && <p>AI extraction proposed items that are not in the file text, so they were discarded: {result.dropped.join("; ")}</p>}
          {result.ai_error && <p>AI extraction failed ({result.ai_error.slice(0, 120)}) — used the rule-based parser.</p>}
        </div>
      )}
    </div>
  );
}

function ResumeFiles({ data, reload }: { data: ResumeRow[]; reload: () => void }) {
  const { run } = useAction();
  if (!data.length) return <Empty icon={<FileText className="size-6" />} title="No resumes uploaded" />;
  return (
    <Panel bodyClass="p-0">
      <ul className="divide-y divide-line">
        {data.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5">
            <div>
              <span className="font-medium">{r.filename}</span> {r.is_primary && <Badge tone="accent">primary</Badge>}
              <div className="text-[12px] text-muted">{r.extraction_method === "ai" ? "AI extraction (verified)" : "Rule-based extraction"} · {timeAgo(r.created_at)}</div>
            </div>
            <div className="flex gap-1.5">
              {!r.is_primary && <Button size="sm" onClick={() => run("p", () => patch(`/api/resumes/${r.id}`, { is_primary: true }), "Set as primary").then(reload)}>Set primary</Button>}
              <Button size="sm" onClick={() => confirm("Replace your master profile with this resume's extracted data?") && run("a", () => patch(`/api/resumes/${r.id}`, { apply_to_profile: true }), "Master profile replaced").then(reload)}>Use as master profile</Button>
              <IconButton label="Delete" onClick={() => confirm(`Delete ${r.filename}?`) && run("d", () => del(`/api/resumes/${r.id}`), "Deleted").then(reload)}><Trash2 className="size-3.5" /></IconButton>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function move<T>(arr: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const a = [...arr];
  [a[i], a[j]] = [a[j], a[i]];
  return a;
}

function BulletList({ items, onChange }: { items: Bullet[]; onChange: (b: Bullet[]) => void }) {
  return (
    <div className="space-y-1.5">
      {items.map((b, i) => (
        <div key={b.id} className="flex items-start gap-1.5">
          <span className="mt-2 text-faint">•</span>
          <Textarea rows={Math.max(1, Math.ceil(b.text.length / 120))} className="min-h-0 py-1.5" value={b.text} onChange={(e) => onChange(items.map((x) => (x.id === b.id ? { ...x, text: e.target.value } : x)))} />
          <div className="flex flex-col">
            <IconButton label="Move up" className="size-6" onClick={() => onChange(move(items, i, -1))}><ArrowUp className="size-3" /></IconButton>
            <IconButton label="Move down" className="size-6" onClick={() => onChange(move(items, i, 1))}><ArrowDown className="size-3" /></IconButton>
          </div>
          <IconButton label="Remove bullet" onClick={() => onChange(items.filter((x) => x.id !== b.id))}><Trash2 className="size-3.5" /></IconButton>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => onChange([...items, { id: uid("b_"), text: "" }])}>Add bullet</Button>
    </div>
  );
}

function ProfileEditor({ initial, years, onSaved }: { initial: CareerProfile; years: number; onSaved: () => void }) {
  const [p, setP] = useState<CareerProfile>(initial);
  const [dirty, setDirty] = useState(false);
  const { busy, run } = useAction();
  const set = (patch: Partial<CareerProfile>) => {
    setP((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  const save = () => run("save", () => put("/api/profile", { profile: { ...p, experience: p.experience.map((e) => ({ ...e, bullets: e.bullets.filter((b) => b.text.trim()) })) } }), "Master profile saved").then((r) => { if (r) { setDirty(false); onSaved(); } });
  if (!p.name && !p.experience.length && !dirty)
    return <Empty icon={<FileText className="size-6" />} title="No profile yet" action={<Button onClick={() => setDirty(true)}>Fill in manually</Button>}>Upload your resume above, or fill in the profile by hand.</Empty>;
  return (
    <div className="space-y-4 pb-16">
      {(p.unknown_fields?.length ?? 0) > 0 && (
        <div className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
          <AlertTriangle className="mr-1 inline size-3.5" /> Missing from your resume: <b>{p.unknown_fields!.join(", ")}</b>. These will be flagged, never guessed, when filling applications.
        </div>
      )}
      <Panel title="Contact">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Full name"><Input value={p.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Email"><Input value={p.email} onChange={(e) => set({ email: e.target.value })} /></Field>
          <Field label="Phone"><Input value={p.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label="Location"><Input value={p.location} onChange={(e) => set({ location: e.target.value })} /></Field>
        </div>
        <div className="mt-3 space-y-1.5">
          <span className="text-[12px] font-medium text-muted">Links</span>
          {p.links.map((l, i) => (
            <div key={i} className="flex gap-2">
              <Input className="w-36" value={l.label} onChange={(e) => set({ links: p.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <Input value={l.url} onChange={(e) => set({ links: p.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} placeholder="https://…" />
              <IconButton label="Remove link" onClick={() => set({ links: p.links.filter((_, j) => j !== i) })}><Trash2 className="size-3.5" /></IconButton>
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => set({ links: [...p.links, { label: "LinkedIn", url: "" }] })}>Add link</Button>
        </div>
      </Panel>
      <Panel title="Professional summary">
        <Textarea rows={5} value={p.summary} onChange={(e) => set({ summary: e.target.value })} />
      </Panel>
      <Panel title={<span>Experience <span className="font-normal text-muted">· ~{years} yrs counted (internships at half weight)</span></span>} actions={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => set({ experience: [{ id: uid("e_"), title: "", company: "", start: "", end: "", bullets: [] }, ...p.experience] })}>Add role</Button>}>
        <div className="space-y-5">
          {p.experience.map((e, i) => (
            <div key={e.id} className="space-y-2 border-b border-line pb-4 last:border-0 last:pb-0">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[2fr_2fr_1fr_1fr_1fr_auto]">
                <Field label="Title"><Input value={e.title} onChange={(ev) => set({ experience: p.experience.map((x) => (x.id === e.id ? { ...x, title: ev.target.value } : x)) })} /></Field>
                <Field label="Company"><Input value={e.company} onChange={(ev) => set({ experience: p.experience.map((x) => (x.id === e.id ? { ...x, company: ev.target.value } : x)) })} /></Field>
                <Field label="Start"><Input value={e.start ?? ""} placeholder="Dec 2025" onChange={(ev) => set({ experience: p.experience.map((x) => (x.id === e.id ? { ...x, start: ev.target.value } : x)) })} /></Field>
                <Field label="End"><Input value={e.end ?? ""} placeholder="Present" onChange={(ev) => set({ experience: p.experience.map((x) => (x.id === e.id ? { ...x, end: ev.target.value, current: /present/i.test(ev.target.value) } : x)) })} /></Field>
                <Field label="Type"><Input value={e.employment_type ?? ""} placeholder="full-time" onChange={(ev) => set({ experience: p.experience.map((x) => (x.id === e.id ? { ...x, employment_type: ev.target.value } : x)) })} /></Field>
                <div className="flex items-end gap-0.5 pb-0.5">
                  <IconButton label="Move up" onClick={() => set({ experience: move(p.experience, i, -1) })}><ArrowUp className="size-3.5" /></IconButton>
                  <IconButton label="Move down" onClick={() => set({ experience: move(p.experience, i, 1) })}><ArrowDown className="size-3.5" /></IconButton>
                  <IconButton label="Delete role" onClick={() => confirm("Delete this role?") && set({ experience: p.experience.filter((x) => x.id !== e.id) })}><Trash2 className="size-3.5" /></IconButton>
                </div>
              </div>
              <BulletList items={e.bullets} onChange={(b) => set({ experience: p.experience.map((x) => (x.id === e.id ? { ...x, bullets: b } : x)) })} />
            </div>
          ))}
          {!p.experience.length && <p className="text-muted">No roles yet.</p>}
        </div>
      </Panel>
      <Panel title="Projects" actions={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => set({ projects: [...p.projects, { id: uid("p_"), name: "", technologies: [], bullets: [] }] })}>Add project</Button>}>
        <div className="space-y-4">
          {p.projects.map((pr) => (
            <div key={pr.id} className="space-y-2 border-b border-line pb-3 last:border-0">
              <div className="grid gap-2 sm:grid-cols-[2fr_2fr_auto]">
                <Field label="Name"><Input value={pr.name} onChange={(e) => set({ projects: p.projects.map((x) => (x.id === pr.id ? { ...x, name: e.target.value } : x)) })} /></Field>
                <Field label="Technologies (comma-separated)"><Input value={(pr.technologies ?? []).join(", ")} onChange={(e) => set({ projects: p.projects.map((x) => (x.id === pr.id ? { ...x, technologies: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } : x)) })} /></Field>
                <div className="flex items-end pb-0.5"><IconButton label="Delete project" onClick={() => set({ projects: p.projects.filter((x) => x.id !== pr.id) })}><Trash2 className="size-3.5" /></IconButton></div>
              </div>
              <BulletList items={pr.bullets} onChange={(b) => set({ projects: p.projects.map((x) => (x.id === pr.id ? { ...x, bullets: b } : x)) })} />
            </div>
          ))}
        </div>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Skills" actions={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => set({ skills: [...p.skills, { category: "New category", items: [] }] })}>Add category</Button>}>
          <div className="space-y-2">
            {p.skills.map((g, i) => (
              <div key={i} className="flex gap-2">
                <Input className="w-44" value={g.category} onChange={(e) => set({ skills: p.skills.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)) })} />
                <Input value={g.items.join(", ")} onChange={(e) => set({ skills: p.skills.map((x, j) => (j === i ? { ...x, items: e.target.value.split(",").map((s) => s.trimStart()) } : x)) })} />
                <IconButton label="Remove category" onClick={() => set({ skills: p.skills.filter((_, j) => j !== i) })}><Trash2 className="size-3.5" /></IconButton>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Education" actions={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => set({ education: [...p.education, { id: uid("ed_"), degree: "", institution: "" }] })}>Add</Button>}>
          <div className="space-y-3">
            {p.education.map((ed) => (
              <div key={ed.id} className="grid grid-cols-2 gap-2">
                <Input placeholder="Degree" value={ed.degree} onChange={(e) => set({ education: p.education.map((x) => (x.id === ed.id ? { ...x, degree: e.target.value } : x)) })} />
                <Input placeholder="Field" value={ed.field ?? ""} onChange={(e) => set({ education: p.education.map((x) => (x.id === ed.id ? { ...x, field: e.target.value } : x)) })} />
                <Input placeholder="Institution" value={ed.institution} onChange={(e) => set({ education: p.education.map((x) => (x.id === ed.id ? { ...x, institution: e.target.value } : x)) })} />
                <div className="flex gap-2">
                  <Input placeholder="Grade" value={ed.grade ?? ""} onChange={(e) => set({ education: p.education.map((x) => (x.id === ed.id ? { ...x, grade: e.target.value } : x)) })} />
                  <IconButton label="Remove" onClick={() => set({ education: p.education.filter((x) => x.id !== ed.id) })}><Trash2 className="size-3.5" /></IconButton>
                </div>
                <Input placeholder="Start" value={ed.start ?? ""} onChange={(e) => set({ education: p.education.map((x) => (x.id === ed.id ? { ...x, start: e.target.value } : x)) })} />
                <Input placeholder="End" value={ed.end ?? ""} onChange={(e) => set({ education: p.education.map((x) => (x.id === ed.id ? { ...x, end: e.target.value } : x)) })} />
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Certifications" actions={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => set({ certifications: [...p.certifications, { id: uid("c_"), name: "" }] })}>Add</Button>}>
          <div className="space-y-2">
            {p.certifications.map((c) => (
              <div key={c.id} className="flex gap-2">
                <Input placeholder="Certification" value={c.name} onChange={(e) => set({ certifications: p.certifications.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)) })} />
                <Input className="w-48" placeholder="Issuer" value={c.issuer ?? ""} onChange={(e) => set({ certifications: p.certifications.map((x) => (x.id === c.id ? { ...x, issuer: e.target.value } : x)) })} />
                <IconButton label="Remove" onClick={() => set({ certifications: p.certifications.filter((x) => x.id !== c.id) })}><Trash2 className="size-3.5" /></IconButton>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Achievements & languages">
          <BulletList items={p.achievements} onChange={(b) => set({ achievements: b })} />
          <div className="mt-3 space-y-2">
            {p.languages.map((l, i) => (
              <div key={i} className="flex gap-2">
                <Input value={l.name} onChange={(e) => set({ languages: p.languages.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <Input value={l.proficiency ?? ""} placeholder="Proficiency" onChange={(e) => set({ languages: p.languages.map((x, j) => (j === i ? { ...x, proficiency: e.target.value } : x)) })} />
                <IconButton label="Remove" onClick={() => set({ languages: p.languages.filter((_, j) => j !== i) })}><Trash2 className="size-3.5" /></IconButton>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => set({ languages: [...p.languages, { name: "" }] })}>Add language</Button>
          </div>
        </Panel>
      </div>
      <div className={cn("fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line bg-elev px-4 py-2 shadow-xl transition-opacity", dirty ? "opacity-100" : "pointer-events-none opacity-0")}>
        <span className="text-[13px]">Unsaved changes to your master profile</span>
        <Button size="sm" onClick={() => { setP(initial); setDirty(false); }}>Discard</Button>
        <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} loading={busy === "save"} onClick={save}>Save profile</Button>
      </div>
    </div>
  );
}
