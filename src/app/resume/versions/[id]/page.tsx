"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Download, Eye, EyeOff, Plus, Redo2, RefreshCw, Save, Trash2, Undo2 } from "lucide-react";
import type { CareerProfile } from "@/lib/types";
import { ALL_SECTIONS, type SectionName, type TailoredResume, type TailoredBullet } from "@/lib/resume/tailor";
import { downloadFile, post, put, timeAgo, useApi } from "@/lib/client";
import { Badge, Button, ErrorNote, IconButton, Input, Loading, Panel, Segmented, Textarea, cn, useAction } from "@/components/ui";

interface VersionResp {
  version: { id: string; job_id: string; version: number; file_name: string; method: string; generated_content: TailoredResume; change_log: { type: string; text: string }[]; created_at: string; updated_at: string };
  master: CareerProfile;
}

const LABEL: Record<SectionName, string> = { summary: "Summary", skills: "Skills", experience: "Experience", projects: "Projects", education: "Education", certifications: "Certifications", achievements: "Achievements", languages: "Languages" };

// Word diff (client copy to keep the bundle free of server code)
function diff(a: string, b: string) {
  const A = a.split(/(\s+)/);
  const B = b.split(/(\s+)/);
  const dp: number[][] = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { t: "s" | "a" | "d"; x: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) out.push({ t: "s", x: A[i++] }), j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: "d", x: A[i++] });
    else out.push({ t: "a", x: B[j++] });
  }
  while (i < A.length) out.push({ t: "d", x: A[i++] });
  while (j < B.length) out.push({ t: "a", x: B[j++] });
  return out;
}

function Diff({ a, b }: { a: string; b: string }) {
  if (a === b) return <span>{b}</span>;
  return (
    <span>
      {diff(a, b).map((p, i) => (
        <span key={i} className={p.t === "a" ? "diff-add" : p.t === "d" ? "diff-del" : ""}>{p.x}</span>
      ))}
    </span>
  );
}

export default function VersionEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<VersionResp>(`/api/resume-versions/${id}`);
  const [doc, setDoc] = useState<TailoredResume | null>(null);
  const [past, setPast] = useState<TailoredResume[]>([]);
  const [future, setFuture] = useState<TailoredResume[]>([]);
  const [mode, setMode] = useState<"edit" | "compare" | "preview">("edit");
  const [warnings, setWarnings] = useState<string[]>([]);
  const { busy, run } = useAction();

  useEffect(() => {
    if (data) {
      setDoc(structuredClone(data.version.generated_content));
      setPast([]);
      setFuture([]);
    }
  }, [data]);

  const update = useCallback((fn: (d: TailoredResume) => TailoredResume) => {
    setDoc((cur) => {
      if (!cur) return cur;
      setPast((p) => [...p.slice(-60), cur]);
      setFuture([]);
      return fn(structuredClone(cur));
    });
  }, []);
  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      setDoc((cur) => {
        if (cur) setFuture((f) => [cur, ...f]);
        return p[p.length - 1];
      });
      return p.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      setDoc((cur) => {
        if (cur) setPast((p) => [...p, cur]);
        return f[0];
      });
      return f.slice(1);
    });
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "TEXTAREA" || t.tagName === "INPUT") return; // native text undo inside fields
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [undo, redo]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data || !doc) return null;
  const v = data.version;
  const dirty = JSON.stringify(doc) !== JSON.stringify(v.generated_content);
  const save = () => run("save", () => put<{ warnings: string[] }>(`/api/resume-versions/${id}`, { content: doc, note: "manual edit" }), "Saved").then((r) => { if (r) { setWarnings(r.warnings); reload(); } });
  const exp = async (fmt: "pdf" | "docx") => {
    if (dirty) await put(`/api/resume-versions/${id}`, { content: doc, note: "saved before export" });
    await run("dl", () => downloadFile(`/api/resume-versions/${id}/export?format=${fmt}`));
  };
  const setBullet = (kind: "experience" | "projects", itemId: string, bid: string, text: string) =>
    update((d) => {
      const it = (d[kind] as { id: string; bullets: TailoredBullet[] }[]).find((x) => x.id === itemId)!;
      it.bullets = it.bullets.map((b) => (b.source_id === bid ? { ...b, text, changed: text !== b.original } : b));
      return d;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/jobs/${v.job_id}?tab=resume`} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> {doc.job.title} — {doc.job.company}</Link>
          <h1 className="mt-1 text-[18px] font-semibold">{v.file_name}</h1>
          <p className="text-[12px] text-muted">v{v.version} · {v.method === "ai" ? "AI rewrite, truth-checked" : "rule-based"} · edited {timeAgo(v.updated_at)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Segmented value={mode} onChange={setMode} items={[{ value: "edit", label: "Edit" }, { value: "compare", label: "Compare" }, { value: "preview", label: "Preview" }]} />
          <IconButton label="Undo (⌘Z)" disabled={!past.length} onClick={undo}><Undo2 className="size-4" /></IconButton>
          <IconButton label="Redo (⌘⇧Z)" disabled={!future.length} onClick={redo}><Redo2 className="size-4" /></IconButton>
          <Button icon={<RefreshCw className="size-3.5" />} loading={busy === "regen"} onClick={() => run("regen", () => post<{ id: string }>(`/api/jobs/${v.job_id}/tailor`), "New version generated").then((r) => r && router.push(`/resume/versions/${r.id}`))}>Regenerate</Button>
          <Button icon={<Download className="size-3.5" />} loading={busy === "dl"} onClick={() => exp("pdf")}>PDF</Button>
          <Button icon={<Download className="size-3.5" />} onClick={() => exp("docx")}>DOCX</Button>
          <Button variant="primary" icon={<Save className="size-3.5" />} disabled={!dirty} loading={busy === "save"} onClick={save}>Save</Button>
        </div>
      </div>
      {(doc.warnings.length > 0 || warnings.length > 0) && (
        <div className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[12.5px] text-warn">{[...doc.warnings, ...warnings].map((w) => <p key={w}>{w}</p>)}</div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {mode === "preview" ? (
            <Preview r={doc} />
          ) : (
            doc.section_order.map((s, i) => {
              const hidden = doc.hidden_sections.includes(s);
              return (
                <Panel
                  key={s}
                  className={cn(hidden && "opacity-50")}
                  title={LABEL[s]}
                  actions={
                    mode === "edit" && (
                      <>
                        <IconButton label="Move section up" onClick={() => update((d) => { const o = d.section_order; if (i > 0) [o[i - 1], o[i]] = [o[i], o[i - 1]]; return d; })}><ArrowUp className="size-3.5" /></IconButton>
                        <IconButton label="Move section down" onClick={() => update((d) => { const o = d.section_order; if (i < o.length - 1) [o[i + 1], o[i]] = [o[i], o[i + 1]]; return d; })}><ArrowDown className="size-3.5" /></IconButton>
                        <IconButton label={hidden ? "Show section" : "Hide section"} onClick={() => update((d) => { d.hidden_sections = hidden ? d.hidden_sections.filter((x) => x !== s) : [...d.hidden_sections, s]; return d; })}>{hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}</IconButton>
                      </>
                    )
                  }
                >
                  <SectionBody s={s} doc={doc} mode={mode} update={update} setBullet={setBullet} />
                </Panel>
              );
            })
          )}
          {mode === "edit" && ALL_SECTIONS.filter((s) => !doc.section_order.includes(s)).map((s) => (
            <Button key={s} size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => update((d) => { d.section_order.push(s); return d; })}>Add {LABEL[s]} section</Button>
          ))}
        </div>
        <aside className="space-y-3">
          <Panel title="What changed">
            <ul className="space-y-1.5 text-[12.5px]">
              {doc.changes.map((c) => <li key={c} className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />{c}</li>)}
              {!doc.changes.length && <li className="text-muted">No structural changes.</li>}
            </ul>
            {v.change_log.filter((c) => c.type === "rejected").length > 0 && (
              <details className="mt-3 text-[12px]">
                <summary className="cursor-pointer text-warn">{v.change_log.filter((c) => c.type === "rejected").length} AI suggestion(s) rejected by the truth check</summary>
                <ul className="mt-1.5 space-y-1 text-muted">{v.change_log.filter((c) => c.type === "rejected").map((c, i) => <li key={i}>{c.text}</li>)}</ul>
              </details>
            )}
          </Panel>
          <Panel title="Keyword alignment">
            <div className="flex flex-wrap gap-1">{doc.keywords.matched.map((k) => <Badge key={k} tone="ok">{k}</Badge>)}</div>
            {doc.keywords.not_claimed.length > 0 && (
              <>
                <p className="mb-1 mt-3 text-[12px] text-muted">In the job, not in your profile (not added):</p>
                <div className="flex flex-wrap gap-1">{doc.keywords.not_claimed.map((k) => <Badge key={k}>{k}</Badge>)}</div>
                <p className="mt-2 text-[11.5px] text-faint">If you genuinely have any of these, add them to your master profile — then regenerate.</p>
              </>
            )}
          </Panel>
          <Panel title="ATS checklist">
            <ul className="space-y-1 text-[12.5px] text-muted">
              <li>✓ Single column, standard section headings</li>
              <li>✓ No tables, images or text boxes</li>
              <li>✓ Standard fonts (Helvetica / Calibri)</li>
              <li>✓ Contact details in plain text</li>
              <li>{doc.keywords.matched.length >= 3 ? "✓" : "•"} {doc.keywords.matched.length} truthful keyword matches</li>
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function SectionBody({ s, doc, mode, update, setBullet }: { s: SectionName; doc: TailoredResume; mode: string; update: (fn: (d: TailoredResume) => TailoredResume) => void; setBullet: (k: "experience" | "projects", item: string, bid: string, text: string) => void }) {
  const editing = mode === "edit";
  if (s === "summary")
    return editing ? (
      <Textarea rows={4} value={doc.summary} onChange={(e) => { const v = e.target.value; update((d) => ({ ...d, summary: v })); }} />
    ) : (
      <p className="text-[13px]"><Diff a={doc.summary_original} b={doc.summary} /></p>
    );
  if (s === "skills")
    return (
      <div className="space-y-1.5">
        {doc.skills.map((g, gi) => (
          <div key={gi} className="flex gap-2 text-[13px]">
            <span className="w-44 shrink-0 font-medium">{g.category}</span>
            {editing ? <Input value={g.items.join(", ")} onChange={(e) => { const v = e.target.value; update((d) => { d.skills[gi].items = v.split(",").map((x) => x.trimStart()); return d; }); }} /> : <span>{g.items.join(", ")}</span>}
          </div>
        ))}
      </div>
    );
  if (s === "experience" || s === "projects") {
    const items = doc[s] as { id: string; title?: string; name?: string; company?: string; start?: string; end?: string; technologies?: string[]; bullets: TailoredBullet[] }[];
    return (
      <div className="space-y-4">
        {items.map((it, ii) => (
          <div key={it.id}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">{it.title ?? it.name}{it.company && <span className="font-normal text-muted"> · {it.company}</span>}{it.technologies?.length ? <span className="font-normal text-muted"> ({it.technologies.join(", ")})</span> : null}</span>
              <span className="flex items-center gap-1 text-[12px] text-faint">
                {[it.start, it.end].filter(Boolean).join(" – ")}
                {editing && (
                  <>
                    <IconButton label="Move up" className="size-6" onClick={() => update((d) => { const a = d[s] as unknown[]; if (ii > 0) [a[ii - 1], a[ii]] = [a[ii], a[ii - 1]]; return d; })}><ArrowUp className="size-3" /></IconButton>
                    <IconButton label="Remove from this resume" className="size-6" onClick={() => update((d) => { (d[s] as unknown[]).splice(ii, 1); return d; })}><Trash2 className="size-3" /></IconButton>
                  </>
                )}
              </span>
            </div>
            <ul className="mt-1.5 space-y-1.5">
              {it.bullets.map((b, bi) => (
                <li key={b.source_id} className="flex items-start gap-1.5 text-[13px]">
                  <span className={cn("text-faint", editing ? "mt-2" : "")}>•</span>
                  {editing ? (
                    <>
                      <Textarea rows={Math.max(1, Math.ceil(b.text.length / 115))} className="min-h-0 py-1.5" value={b.text} onChange={(e) => setBullet(s, it.id, b.source_id, e.target.value)} />
                      <div className="flex flex-col">
                        <IconButton label="Move up" className="size-6" onClick={() => update((d) => { const bs = (d[s] as { bullets: TailoredBullet[] }[])[ii].bullets; if (bi > 0) [bs[bi - 1], bs[bi]] = [bs[bi], bs[bi - 1]]; return d; })}><ArrowUp className="size-3" /></IconButton>
                        <IconButton label="Delete bullet" className="size-6" onClick={() => update((d) => { (d[s] as { bullets: TailoredBullet[] }[])[ii].bullets.splice(bi, 1); return d; })}><Trash2 className="size-3" /></IconButton>
                      </div>
                      {b.changed && <Badge tone="info" title={`Original: ${b.original}`}>edited</Badge>}
                    </>
                  ) : (
                    <span><Diff a={b.original} b={b.text} /></span>
                  )}
                </li>
              ))}
            </ul>
            {editing && (
              <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => update((d) => { (d[s] as { bullets: TailoredBullet[] }[])[ii].bullets.push({ source_id: `user_${Date.now()}`, text: "", original: "", changed: true, relevance: 0 }); return d; })}>Add bullet (your own words)</Button>
            )}
          </div>
        ))}
      </div>
    );
  }
  if (s === "education") return <ul className="space-y-1 text-[13px]">{doc.education.map((e) => <li key={e.id}><b>{e.degree}</b>{e.field && ` – ${e.field}`} · {e.institution} {e.grade && `· ${e.grade}`} <span className="text-faint">{[e.start, e.end].filter(Boolean).join(" – ")}</span></li>)}</ul>;
  if (s === "certifications") return <ul className="space-y-1 text-[13px]">{doc.certifications.map((c) => <li key={c.id}>{c.name}{c.issuer && <span className="text-muted"> – {c.issuer}</span>}</li>)}</ul>;
  if (s === "achievements") return <ul className="space-y-1 text-[13px]">{doc.achievements.map((a) => <li key={a.id}>• {a.text}</li>)}</ul>;
  return <p className="text-[13px]">{doc.languages.map((l) => (l.proficiency ? `${l.name} (${l.proficiency})` : l.name)).join(", ")}</p>;
}

function Preview({ r }: { r: TailoredResume }) {
  const vis = r.section_order.filter((s) => !r.hidden_sections.includes(s));
  return (
    <div className="mx-auto max-w-[800px] rounded-md border border-line bg-white p-10 text-[13px] leading-snug text-neutral-900 shadow-sm" style={{ fontFamily: "Helvetica, Arial, sans-serif" }}>
      <h2 className="text-center text-[22px] font-bold">{r.header.name}</h2>
      {r.headline && <p className="text-center">{r.headline}</p>}
      <p className="text-center text-[12px]">{[r.header.location, r.header.phone, r.header.email].filter(Boolean).join(" | ")}</p>
      {r.header.links.length > 0 && <p className="text-center text-[12px]">{r.header.links.map((l) => l.url.replace(/^https?:\/\/(www\.)?/, "")).join(" | ")}</p>}
      {vis.map((s) => (
        <section key={s} className="mt-3">
          <h3 className="border-b border-neutral-400 pb-0.5 text-[12.5px] font-bold uppercase tracking-wide">{LABEL[s] === "Experience" ? "Professional Experience" : LABEL[s] === "Summary" ? "Professional Summary" : LABEL[s]}</h3>
          <div className="mt-1.5 space-y-1.5">
            {s === "summary" && <p>{r.summary}</p>}
            {s === "skills" && r.skills.filter((g) => g.items.length).map((g) => <p key={g.category}><b>{g.category}:</b> {g.items.join(", ")}</p>)}
            {s === "experience" && r.experience.map((e) => (
              <div key={e.id}>
                <div className="flex justify-between"><b>{e.title}</b><span>{[e.start, e.end].filter(Boolean).join(" – ")}</span></div>
                <i>{[e.company, e.location].filter(Boolean).join(", ")}</i>
                <ul className="ml-4 list-disc">{e.bullets.map((b) => <li key={b.source_id}>{b.text}</li>)}</ul>
              </div>
            ))}
            {s === "projects" && r.projects.map((p) => (
              <div key={p.id}>
                <b>{p.name}{p.technologies?.length ? ` (${p.technologies.join(", ")})` : ""}</b>
                <ul className="ml-4 list-disc">{p.bullets.map((b) => <li key={b.source_id}>{b.text}</li>)}</ul>
              </div>
            ))}
            {s === "education" && r.education.map((e) => (
              <div key={e.id}>
                <div className="flex justify-between"><b>{[e.degree, e.field].filter(Boolean).join(" – ")}</b><span>{[e.start, e.end].filter(Boolean).join(" – ")}</span></div>
                <p>{[e.institution, e.grade].filter(Boolean).join(" | ")}</p>
              </div>
            ))}
            {s === "certifications" && <ul className="ml-4 list-disc">{r.certifications.map((c) => <li key={c.id}>{[c.name, c.issuer].filter(Boolean).join(" – ")}</li>)}</ul>}
            {s === "achievements" && <ul className="ml-4 list-disc">{r.achievements.map((a) => <li key={a.id}>{a.text}</li>)}</ul>}
            {s === "languages" && <p>{r.languages.map((l) => (l.proficiency ? `${l.name} (${l.proficiency})` : l.name)).join(", ")}</p>}
          </div>
        </section>
      ))}
    </div>
  );
}
