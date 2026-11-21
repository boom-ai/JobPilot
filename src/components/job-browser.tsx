"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ExternalLink, Filter, Merge, Plus, Search as SearchIcon, SlidersHorizontal, Star, EyeOff, Globe } from "lucide-react";
import type { JobFilters, JobRow } from "@/lib/types";
import { api, patch, post, useApi } from "@/lib/client";
import { Badge, Button, Empty, ErrorNote, Field, Input, Loading, Modal, Select, Tabs, Textarea, cn, useAction, Checkbox } from "./ui";
import { JobCard, sourceLabel } from "./jobs";
import { countActive, FilterPanel, PresetBar, type SavedSearch } from "./filters";

type View = "discover" | "matches" | "shortlist";
interface ListResp {
  total: number;
  excluded: number;
  jobs: JobRow[];
}
interface SourceInfo {
  id: string;
  name: string;
  kind: string;
  status: string;
  notes: string;
  search_url: string | null;
  last_result: { ok: boolean; count: number; error?: string; skipped?: string } | null;
}

const SORTS = [
  { v: "score", l: "Match score" },
  { v: "posted", l: "Date posted" },
  { v: "discovered", l: "Recently discovered" },
  { v: "salary", l: "Salary" },
  { v: "company", l: "Company" },
  { v: "location", l: "Location" },
  { v: "remote", l: "Remote first" },
  { v: "deadline", l: "Application deadline" },
];

function loadFilters(key: string): JobFilters {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}");
  } catch {
    return {};
  }
}

export function JobBrowser({ view }: { view: View }) {
  const params = useSearchParams();
  const storeKey = `jp.filters.${view}`;
  const [filters, setFilters] = useState<JobFilters>({});
  const [ready, setReady] = useState(false);
  const [q, setQ] = useState(params.get("q") ?? "");
  const [qApplied, setQApplied] = useState(params.get("q") ?? "");
  const [sort, setSort] = useState(view === "discover" ? "discovered" : "score");
  const [tab, setTab] = useState<"all" | "hidden" | "duplicates">("all");
  const [limit, setLimit] = useState(40);
  const [showFilters, setShowFilters] = useState(view === "discover");
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { busy, run } = useAction();

  useEffect(() => {
    setFilters(loadFilters(storeKey));
    try {
      setSort(localStorage.getItem(`${storeKey}.sort`) ?? (view === "discover" ? "discovered" : "score"));
    } catch {}
    setReady(true);
  }, [storeKey, view]);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(storeKey, JSON.stringify(filters));
      localStorage.setItem(`${storeKey}.sort`, sort);
    } catch {}
  }, [filters, sort, storeKey, ready]);

  const apiView = tab === "all" ? view : tab;
  const url = ready ? `/api/jobs?view=${apiView}&sort=${sort}&limit=${limit}&q=${encodeURIComponent(qApplied)}&filters=${encodeURIComponent(JSON.stringify(filters))}` : null;
  const { data, error, loading, reload } = useApi<ListResp>(url);
  const searches = useApi<{ searches: SavedSearch[] }>(view === "discover" ? "/api/searches" : null);

  const onSelect = useCallback((id: string, v: boolean) => setSelected((s) => {
    const n = new Set(s);
    if (v) n.add(id);
    else n.delete(id);
    return n;
  }), []);

  const bulk = (action: string) =>
    run(action, async () => {
      for (const id of selected) await patch(`/api/jobs/${id}`, { action });
      return selected.size;
    }, (n) => `${n} job(s) updated`).then(() => {
      setSelected(new Set());
      reload();
    });

  const merge = () => {
    const ids = [...selected];
    const primary = data?.jobs.filter((j) => ids.includes(j.id)).sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0))[0];
    if (!primary) return;
    run("merge", () => post("/api/jobs/merge", { primary_id: primary.id, duplicate_ids: ids }), `Merged into “${primary.title}”`).then(() => {
      setSelected(new Set());
      reload();
    });
  };

  const active = countActive(filters);
  const title = view === "discover" ? "Discover Jobs" : view === "matches" ? "AI Matches" : "Shortlist";
  const subtitle =
    view === "discover"
      ? "Every job collected from your sources, deduplicated and scored against your profile."
      : view === "matches"
        ? "Jobs scoring at or above your Moderate threshold, ranked by fit."
        : "Jobs you've saved or shortlisted and those in preparation.";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight">{title}</h1>
          <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view === "discover" && (
            <>
              <Button icon={<Plus className="size-3.5" />} onClick={() => setAddOpen(true)}>Add job</Button>
              <Button variant="primary" icon={<Globe className="size-3.5" />} onClick={() => setSearchOpen(true)}>Search sources</Button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-[240px] flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setQApplied(q);
          }}
        >
          <SearchIcon className="absolute left-2.5 top-2 size-4 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title, company, keyword… (use OR / commas for alternatives)" className="pl-8" />
        </form>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-[220px]" aria-label="Sort by">
          {SORTS.map((s) => <option key={s.v} value={s.v}>Sort: {s.l}</option>)}
        </Select>
        <Button icon={<SlidersHorizontal className="size-3.5" />} onClick={() => setShowFilters((s) => !s)} variant={showFilters ? "outline" : "secondary"}>
          Filters {active > 0 && <Badge tone="accent">{active}</Badge>}
        </Button>
      </div>

      {view === "discover" && searches.data && (
        <PresetBar
          searches={searches.data.searches}
          active={activePreset}
          currentFilters={filters}
          currentQuery={qApplied}
          onApply={(s) => {
            if (activePreset === s.id) {
              setActivePreset(null);
              setFilters({});
              return;
            }
            setActivePreset(s.id);
            setFilters(s.filters ?? {});
          }}
          onChanged={() => {
            searches.reload();
            reload();
          }}
        />
      )}

      <div className="flex gap-5">
        {showFilters && (
          <aside className="scroll-thin sticky top-0 hidden max-h-[calc(100dvh-140px)] w-[270px] shrink-0 overflow-y-auto rounded-lg border border-line bg-elev p-3.5 md:block">
            <div className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold"><Filter className="size-3.5" /> Filters</div>
            <FilterPanel value={filters} onChange={(f) => { setFilters(f); setActivePreset(null); }} onReset={() => { setFilters({}); setActivePreset(null); }} />
          </aside>
        )}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs value={tab} onChange={(v) => { setTab(v); setSelected(new Set()); }} items={[{ value: "all", label: "Jobs", count: tab === "all" ? data?.total : undefined }, { value: "hidden", label: "Hidden" }, { value: "duplicates", label: "Merged duplicates" }]} />
            {selected.size > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[12.5px] text-muted">{selected.size} selected</span>
                <Button size="sm" icon={<Star className="size-3.5" />} loading={busy === "shortlist"} onClick={() => bulk("shortlist")}>Shortlist</Button>
                <Button size="sm" icon={<EyeOff className="size-3.5" />} loading={busy === "hide"} onClick={() => bulk(tab === "hidden" ? "unhide" : "hide")}>{tab === "hidden" ? "Unhide" : "Hide"}</Button>
                {selected.size > 1 && <Button size="sm" icon={<Merge className="size-3.5" />} loading={busy === "merge"} onClick={merge}>Merge as duplicates</Button>}
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
              </div>
            )}
          </div>
          {error && <ErrorNote error={error} onRetry={reload} />}
          {loading && !data ? (
            <Loading />
          ) : data && data.jobs.length ? (
            <>
              {data.excluded > 0 && <p className="text-[12px] text-faint">{data.excluded} job(s) hidden by current filters.</p>}
              <div className={cn("space-y-2", loading && "opacity-60")}>
                {data.jobs.map((j) => (
                  <div key={j.id} className="relative">
                    <JobCard job={j} onChanged={reload} selected={selected.has(j.id)} onSelect={onSelect} />
                    {tab === "duplicates" && (
                      <Button size="sm" variant="ghost" className="absolute right-3 top-12" onClick={() => run("unmerge", () => post(`/api/jobs/${j.id}/unmerge`), "Unmerged").then(reload)}>Unmerge</Button>
                    )}
                  </div>
                ))}
              </div>
              {data.total > data.jobs.length && (
                <div className="flex justify-center">
                  <Button onClick={() => setLimit((l) => l + 40)} loading={loading}>Load more ({data.total - data.jobs.length} remaining)</Button>
                </div>
              )}
            </>
          ) : (
            <Empty title={view === "shortlist" ? "Nothing shortlisted yet" : view === "matches" ? "No matches yet" : "No jobs yet"} action={view === "discover" ? <Button variant="primary" onClick={() => setSearchOpen(true)}>Search sources</Button> : undefined}>
              {active ? "Try relaxing your filters." : view === "matches" ? "Run a search; jobs are scored automatically once your resume is uploaded." : view === "shortlist" ? "Use the ★ on any job to shortlist it." : "Run a search across your sources or add a job manually."}
            </Empty>
          )}
        </div>
      </div>
      {addOpen && <AddJobModal onClose={() => setAddOpen(false)} onAdded={() => { setAddOpen(false); reload(); }} />}
      {searchOpen && <SearchSourcesModal initialKeywords={qApplied} filters={filters} onClose={() => setSearchOpen(false)} onDone={() => reload()} />}
    </div>
  );
}

function SearchSourcesModal({ initialKeywords, filters, onClose, onDone }: { initialKeywords: string; filters: JobFilters; onClose: () => void; onDone: () => void }) {
  const { data } = useApi<{ sources: SourceInfo[] }>(`/api/sources?q=${encodeURIComponent(initialKeywords)}`);
  const [keywords, setKeywords] = useState(initialKeywords);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [applyFilters, setApplyFilters] = useState(false);
  const [result, setResult] = useState<{ inserted: { id: string; title: string; company: string; score: number | null }[]; duplicates: number; excluded: number; sources: { source: string; ok: boolean; count: number; error?: string; skipped?: string }[] } | null>(null);
  const { busy, run } = useAction();
  const automated = useMemo(() => (data?.sources ?? []).filter((s) => s.kind !== "manual"), [data]);
  const manual = useMemo(() => (data?.sources ?? []).filter((s) => s.kind === "manual"), [data]);
  const sel = chosen ?? automated.filter((s) => ["available", "connected"].includes(s.status)).map((s) => s.id);
  const go = () =>
    run("search", () => post<typeof result>("/api/search/run", { keywords, sources: sel, filters: applyFilters ? filters : {} }), (r) => `${r?.inserted.length ?? 0} new jobs added`).then((r) => {
      if (r) {
        setResult(r);
        onDone();
      }
    });
  return (
    <Modal open onClose={onClose} title="Search job sources" wide footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" loading={busy === "search"} disabled={!sel.length} onClick={go}>Run search</Button></>}>
      <div className="space-y-4">
        <Field label="Keywords" hint="Leave empty to use your preferred roles and keywords from Settings."><Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g. LLM evaluator, AI trainer, annotation" /></Field>
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-muted">Automated sources (public APIs, RSS, ATS boards)</div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {automated.map((s) => (
              <label key={s.id} className={cn("flex items-start gap-2 rounded-md border border-line px-2.5 py-2", !["available", "connected"].includes(s.status) && "opacity-60")}>
                <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={sel.includes(s.id)} disabled={!["available", "connected", "api_unavailable"].includes(s.status)} onChange={(e) => setChosen(e.target.checked ? [...sel, s.id] : sel.filter((x) => x !== s.id))} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium">{s.name} <StatusPill status={s.status} /></span>
                  <span className="block text-[11.5px] text-faint">{s.last_result ? (s.last_result.ok ? `Last run: ${s.last_result.count} jobs` : `Last run: ${s.last_result.error ?? s.last_result.skipped}`) : s.notes}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <Checkbox checked={applyFilters} onChange={setApplyFilters} label="Only store jobs that pass my current filters" />
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-muted">Browser-assisted sources — automated access is not permitted; open the search, then save jobs with the extension</div>
          <div className="flex flex-wrap gap-1.5">
            {manual.map((s) => (
              <a key={s.id} href={s.search_url ?? "#"} target="_blank" rel="noreferrer" title={s.notes} className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12.5px] text-muted hover:text-fg">
                {s.name} <ExternalLink className="size-3" />
              </a>
            ))}
          </div>
        </div>
        {result && (
          <div className="rounded-md border border-line bg-subtle p-3 text-[13px]">
            <p className="font-medium">{result.inserted.length} new · {result.duplicates} duplicates merged · {result.excluded} excluded by filters</p>
            <ul className="mt-2 space-y-0.5 text-[12px] text-muted">
              {result.sources.map((s) => <li key={s.source}>{sourceLabel(s.source)}: {s.ok ? `${s.count} jobs` : s.skipped ? `skipped (${s.skipped})` : <span className="text-bad">failed — {s.error}</span>}</li>)}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, ["ok" | "info" | "warn" | "bad" | "neutral", string]> = {
    available: ["info", "Available"],
    connected: ["ok", "Connected"],
    requires_login: ["warn", "Requires login"],
    api_unavailable: ["bad", "API unavailable"],
    manual: ["neutral", "Manual access"],
    disabled: ["neutral", "Disabled"],
    needs_config: ["warn", "Needs config"],
  };
  const [tone, label] = map[status] ?? ["neutral", status];
  return <Badge tone={tone}>{label}</Badge>;
}

function AddJobModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [url, setUrl] = useState("");
  const [form, setForm] = useState({ title: "", company: "", location: "", description: "", salary_text: "" });
  const [note, setNote] = useState<string | null>(null);
  const { busy, run } = useAction();
  const fetchUrl = () =>
    run("fetch", () => api<{ job: { title?: string; company?: string; location?: string | null; description?: string } | null; title: string; text: string }>(`/api/browser/inspect?url=${encodeURIComponent(url)}`)).then((r) => {
      if (!r) return;
      if (r.job?.title) {
        setForm({ title: r.job.title ?? "", company: r.job.company ?? "", location: r.job.location ?? "", description: r.job.description ?? "", salary_text: "" });
        setNote("Filled from the page's structured JobPosting data. Review before saving.");
      } else {
        setForm((f) => ({ ...f, title: f.title || r.title.split(/[|–-]/)[0].trim(), description: r.text.slice(0, 12000) }));
        setNote("No structured job data found — page text copied into the description. Fill in title and company.");
      }
    });
  const save = () =>
    run("save", () => post<{ created: boolean; id?: string; duplicate_of?: string; score?: number; excluded?: string }>("/api/jobs", { ...form, source: "manual", source_url: url || null }), (r) =>
      r.created ? `Added${r.score != null ? ` — match ${r.score}` : ""}` : r.duplicate_of ? "Already in your list (duplicate)" : `Not added: ${r.excluded}`,
    ).then((r) => r && onAdded());
  return (
    <Modal open onClose={onClose} title="Add a job" wide footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy === "save"} disabled={!form.title || !form.company} onClick={save}>Add job</Button></>}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a job URL (career page, Greenhouse, Lever, Ashby…)" />
          <Button loading={busy === "fetch"} disabled={!/^https?:\/\//.test(url)} onClick={fetchUrl}>Fetch</Button>
        </div>
        <p className="text-[12px] text-faint">LinkedIn / Naukri pages require sign-in and can&apos;t be fetched server-side — use the Chrome extension’s “Save Job” on those, or paste the details below.</p>
        {note && <p className="rounded-md bg-info-soft px-2.5 py-1.5 text-[12.5px] text-info">{note}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Company"><Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></Field>
          <Field label="Location"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Remote, India" /></Field>
          <Field label="Salary (optional)"><Input value={form.salary_text} onChange={(e) => setForm({ ...form, salary_text: e.target.value })} placeholder="e.g. 6–8 LPA" /></Field>
        </div>
        <Field label="Description"><Textarea rows={10} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
