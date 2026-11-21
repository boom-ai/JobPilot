"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Bookmark, BookmarkPlus, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, History, Loader2, Plus, RotateCw, Shield, X } from "lucide-react";
import { api, del, downloadFile, post, timeAgo, useApi } from "@/lib/client";
import type { JobRow, MatchAnalysis } from "@/lib/types";
import { Badge, Button, IconButton, Loading, Score, cn, useAction, useToast } from "@/components/ui";
import { MatchBreakdown, StatusBadge } from "@/components/jobs";

interface Tab {
  id: string;
  history: string[];
  index: number;
  jobId: string | null;
}
interface Inspect {
  url: string;
  final_url: string;
  status: number;
  title: string;
  embeddable: boolean;
  embed_block_reason: string | null;
  text: string;
  job: { title?: string } | null;
}
interface JobDetail {
  job: JobRow;
  application: { application_status: string } | null;
  resume_versions: { id: string; file_name: string }[];
  letters: { kind: string; content: string }[];
  answers: { question: string; answer: string; approved: boolean }[];
}

const nid = () => Math.random().toString(36).slice(2, 9);

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <BrowserWorkspace />
    </Suspense>
  );
}

function BrowserWorkspace() {
  const sp = useSearchParams();
  const toast = useToast();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [address, setAddress] = useState("");
  const [page, setPage] = useState<Record<string, Inspect | { error: string } | "loading">>({});
  const [showHistory, setShowHistory] = useState(false);
  const bookmarks = useApi<{ bookmarks: { id: string; title: string; url: string }[] }>("/api/browser/bookmarks");
  const history = useApi<{ history: { id: string; url: string; title: string | null; visited_at: string }[] }>(showHistory ? "/api/browser/history" : null);

  // restore tabs
  useEffect(() => {
    let restored: Tab[] = [];
    try {
      restored = JSON.parse(localStorage.getItem("jp.browser.tabs") ?? "[]");
    } catch {}
    const jobId = sp.get("job");
    if (jobId) {
      api<JobDetail>(`/api/jobs/${jobId}`).then((d) => {
        const url = d.job.apply_url ?? d.job.source_url;
        if (!url) return toast("This job has no URL", "bad");
        const t: Tab = { id: nid(), history: [url], index: 0, jobId };
        setTabs([...restored.filter((x) => x.jobId !== jobId), t]);
        setActive(t.id);
      }).catch((e) => toast(e.message, "bad"));
    } else {
      setTabs(restored);
      setActive(restored[restored.length - 1]?.id ?? null);
    }
  }, [sp, toast]);
  useEffect(() => {
    try {
      localStorage.setItem("jp.browser.tabs", JSON.stringify(tabs.slice(-12)));
    } catch {}
  }, [tabs]);

  const tab = tabs.find((t) => t.id === active) ?? null;
  const url = tab ? tab.history[tab.index] : null;
  useEffect(() => setAddress(url ?? ""), [url]);

  const load = useCallback(async (u: string, jobId: string | null, force = false) => {
    if (!force && page[u] && page[u] !== "loading") return;
    setPage((p) => ({ ...p, [u]: "loading" }));
    try {
      const r = await api<Inspect>(`/api/browser/inspect?url=${encodeURIComponent(u)}`);
      setPage((p) => ({ ...p, [u]: r }));
      post("/api/browser/history", { url: u, title: r.title, job_id: jobId }).catch(() => {});
    } catch (e) {
      setPage((p) => ({ ...p, [u]: { error: (e as Error).message } }));
    }
  }, [page]);
  useEffect(() => {
    if (url && tab) load(url, tab.jobId);
  }, [url, tab, load]);

  const navigate = (raw: string) => {
    let u = raw.trim();
    if (!u) return;
    if (!/^https?:\/\//.test(u)) u = /\.[a-z]{2,}/.test(u) && !u.includes(" ") ? `https://${u}` : `https://www.google.com/search?q=${encodeURIComponent(u)}`;
    if (!tab) {
      const t: Tab = { id: nid(), history: [u], index: 0, jobId: null };
      setTabs((x) => [...x, t]);
      setActive(t.id);
      return;
    }
    setTabs((x) => x.map((t) => (t.id === tab.id ? { ...t, history: [...t.history.slice(0, t.index + 1), u], index: t.index + 1 } : t)));
  };
  const step = (d: -1 | 1) => tab && setTabs((x) => x.map((t) => (t.id === tab.id ? { ...t, index: Math.max(0, Math.min(t.history.length - 1, t.index + d)) } : t)));
  const close = (id: string) => {
    const rest = tabs.filter((t) => t.id !== id);
    setTabs(rest);
    if (active === id) setActive(rest[rest.length - 1]?.id ?? null);
  };
  const current = url ? page[url] : undefined;
  const isBookmarked = !!bookmarks.data?.bookmarks.find((b) => b.url === url);

  return (
    <div className="-mx-6 -my-5 flex h-[calc(100dvh-48px)]">
      {tab?.jobId && panelOpen && <JobPanel jobId={tab.jobId} onClose={() => setPanelOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-end gap-0.5 border-b border-line bg-bg px-2 pt-1.5">
          {tab?.jobId && !panelOpen && <IconButton label="Show job panel" onClick={() => setPanelOpen(true)}><ChevronRight className="size-4" /></IconButton>}
          {tabs.map((t) => {
            const u = t.history[t.index];
            const p = page[u];
            const title = p && p !== "loading" && "title" in p ? p.title : u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40);
            return (
              <div key={t.id} className={cn("group flex h-8 max-w-[220px] items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-[12.5px]", t.id === active ? "border-line bg-elev" : "border-transparent text-muted hover:bg-subtle")}>
                <button className="truncate" onClick={() => setActive(t.id)} title={u}>{p === "loading" && <Loader2 className="mr-1 inline size-3 animate-spin" />}{t.jobId && "💼 "}{title}</button>
                <button aria-label="Close tab" className="text-faint opacity-0 hover:text-fg group-hover:opacity-100" onClick={() => close(t.id)}><X className="size-3" /></button>
              </div>
            );
          })}
          <IconButton label="New tab" onClick={() => { const t: Tab = { id: nid(), history: [], index: -1, jobId: null }; setTabs((x) => [...x, t]); setActive(t.id); }}><Plus className="size-4" /></IconButton>
        </div>
        <div className="flex items-center gap-1 border-b border-line bg-elev px-2 py-1.5">
          <IconButton label="Back" disabled={!tab || tab.index <= 0} onClick={() => step(-1)}><ArrowLeft className="size-4" /></IconButton>
          <IconButton label="Forward" disabled={!tab || tab.index >= tab.history.length - 1} onClick={() => step(1)}><ArrowRight className="size-4" /></IconButton>
          <IconButton label="Reload" disabled={!url} onClick={() => url && load(url, tab?.jobId ?? null, true)}><RotateCw className={cn("size-4", current === "loading" && "animate-spin")} /></IconButton>
          <form className="flex-1" onSubmit={(e) => { e.preventDefault(); navigate(address); }}>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Enter a URL or search" className="h-8 w-full rounded-md border border-line bg-subtle px-3 text-[13px] outline-none focus:border-accent" />
          </form>
          <IconButton label={isBookmarked ? "Remove bookmark" : "Bookmark"} disabled={!url} onClick={async () => {
            if (!url) return;
            const b = bookmarks.data?.bookmarks.find((x) => x.url === url);
            if (b) await del(`/api/browser/bookmarks?id=${b.id}`);
            else await post("/api/browser/bookmarks", { url, title: current && current !== "loading" && "title" in current ? current.title : url });
            bookmarks.reload();
          }}>{isBookmarked ? <Bookmark className="size-4 fill-[var(--accent)] text-accent" /> : <BookmarkPlus className="size-4" />}</IconButton>
          <div className="relative">
            <IconButton label="History" onClick={() => setShowHistory((s) => !s)}><History className="size-4" /></IconButton>
            {showHistory && (
              <div className="absolute right-0 top-8 z-30 max-h-96 w-96 overflow-y-auto rounded-lg border border-line bg-elev shadow-xl">
                <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[12.5px] font-medium">History <Button size="sm" variant="ghost" onClick={async () => { await del("/api/browser/history"); history.reload(); }}>Clear</Button></div>
                {(history.data?.history ?? []).map((h) => (
                  <button key={h.id} onClick={() => { navigate(h.url); setShowHistory(false); }} className="block w-full truncate px-3 py-1.5 text-left text-[12.5px] hover:bg-subtle">
                    {h.title ?? h.url} <span className="text-faint">· {timeAgo(h.visited_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {url && <a href={url} target="_blank" rel="noreferrer" title="Open in a real browser tab (the extension assists there)"><Button size="sm" icon={<ExternalLink className="size-3.5" />}>Open in browser</Button></a>}
        </div>
        {!!bookmarks.data?.bookmarks.length && (
          <div className="flex items-center gap-1 overflow-x-auto border-b border-line bg-elev px-2 py-1">
            {bookmarks.data.bookmarks.map((b) => (
              <button key={b.id} onClick={() => navigate(b.url)} className="max-w-[180px] shrink-0 truncate rounded px-2 py-0.5 text-[12px] text-muted hover:bg-subtle hover:text-fg" title={b.url}>{b.title}</button>
            ))}
          </div>
        )}
        <div className="relative min-h-0 flex-1 bg-elev">
          {!url ? (
            <StartPage onOpen={navigate} />
          ) : current === "loading" || !current ? (
            <div className="flex h-full items-center justify-center text-muted"><Loader2 className="mr-2 size-4 animate-spin" /> Loading…</div>
          ) : "error" in current ? (
            <div className="p-8 text-center">
              <p className="font-medium">Couldn&apos;t load this page</p>
              <p className="mt-1 text-[13px] text-muted">{current.error}</p>
              <a href={url} target="_blank" rel="noreferrer" className="mt-3 inline-block"><Button icon={<ExternalLink className="size-3.5" />}>Open in browser instead</Button></a>
            </div>
          ) : current.embeddable ? (
            <iframe src={url} className="h-full w-full border-0 bg-white" sandbox="allow-scripts allow-forms allow-same-origin allow-popups" title={current.title} />
          ) : (
            <div className="scroll-thin h-full overflow-y-auto">
              <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-warn/30 bg-warn-soft px-4 py-2 text-[12.5px] text-warn">
                <span className="flex items-center gap-1.5"><Shield className="size-3.5" /> This site blocks embedding ({current.embed_block_reason}). Showing a read-only reader view — it is <b>not</b> the live page.</span>
                <a href={url} target="_blank" rel="noreferrer"><Button size="sm" icon={<ExternalLink className="size-3.5" />}>Open live page in browser</Button></a>
              </div>
              <article className="mx-auto max-w-3xl whitespace-pre-line px-6 py-6 text-[13.5px] leading-relaxed">
                <h1 className="mb-3 text-[18px] font-semibold">{current.title}</h1>
                {current.text || "No readable text on this page."}
              </article>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StartPage({ onOpen }: { onOpen: (u: string) => void }) {
  const portals = [
    ["Naukri", "https://www.naukri.com"], ["LinkedIn Jobs", "https://www.linkedin.com/jobs"], ["Indeed", "https://in.indeed.com"], ["Foundit", "https://www.foundit.in"],
    ["Wellfound", "https://wellfound.com/jobs"], ["Instahyre", "https://www.instahyre.com"], ["Cutshort", "https://cutshort.io/jobs"], ["Remote OK", "https://remoteok.com"],
  ];
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h2 className="text-[17px] font-semibold">Browser Workspace</h2>
      <p className="mt-1 text-[13px] text-muted">Open a job from any list with the 🌐 button to get its details, tailored resume, cover letter and answers alongside the page. Most job portals (LinkedIn, Naukri, Indeed, Workday) refuse to be embedded in other apps — for those you get a reader view here and the live page opens in your browser, where the Job Pilot Chrome extension fills forms using this same job context.</p>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {portals.map(([n, u]) => <Button key={u} onClick={() => onOpen(u)}>{n}</Button>)}
      </div>
    </div>
  );
}

function JobPanel({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const { data, loading } = useApi<JobDetail>(`/api/jobs/${jobId}`);
  const { run } = useAction();
  const toast = useToast();
  const letter = useMemo(() => data?.letters.find((l) => l.kind === "cover_letter")?.content, [data]);
  const copy = (t: string, what: string) => navigator.clipboard.writeText(t).then(() => toast(`${what} copied`));
  return (
    <aside className="scroll-thin flex w-[360px] shrink-0 flex-col overflow-y-auto border-r border-line bg-bg">
      <div className="flex h-10 items-center justify-between border-b border-line px-3">
        <span className="text-[12.5px] font-semibold">Job context</span>
        <IconButton label="Collapse job panel" onClick={onClose}><ChevronLeft className="size-4" /></IconButton>
      </div>
      {loading || !data ? (
        <Loading />
      ) : (
        <div className="space-y-4 p-3 text-[13px]">
          <div className="flex items-start justify-between gap-2">
            <div>
              <Link href={`/jobs/${jobId}`} className="font-semibold hover:text-accent">{data.job.title}</Link>
              <p className="text-muted">{data.job.company}</p>
              <div className="mt-1"><StatusBadge status={data.application?.application_status as never} /></div>
            </div>
            <Score value={data.job.match_score} />
          </div>
          {data.job.match_analysis && <details><summary className="cursor-pointer text-[12.5px] text-muted">Match breakdown</summary><div className="mt-2"><MatchBreakdown m={data.job.match_analysis as MatchAnalysis} /></div></details>}
          <section>
            <h4 className="mb-1 text-[12px] font-semibold text-muted">Tailored resume</h4>
            {data.resume_versions[0] ? (
              <div className="flex gap-1.5">
                <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => run("pdf", () => downloadFile(`/api/resume-versions/${data.resume_versions[0].id}/export?format=pdf`))}>PDF</Button>
                <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => run("docx", () => downloadFile(`/api/resume-versions/${data.resume_versions[0].id}/export?format=docx`))}>DOCX</Button>
                <Link href={`/resume/versions/${data.resume_versions[0].id}`}><Button size="sm" variant="ghost">Edit</Button></Link>
              </div>
            ) : (
              <Button size="sm" onClick={() => run("t", () => post(`/api/jobs/${jobId}/tailor`), "Tailored — reopen panel").then(() => location.reload())}>Generate tailored resume</Button>
            )}
          </section>
          <section>
            <h4 className="mb-1 flex items-center justify-between text-[12px] font-semibold text-muted">Cover letter {letter && <IconButton label="Copy cover letter" onClick={() => copy(letter, "Cover letter")}><Copy className="size-3.5" /></IconButton>}</h4>
            {letter ? <p className="line-clamp-6 whitespace-pre-line text-[12.5px] text-muted">{letter}</p> : <p className="text-faint">None yet.</p>}
          </section>
          <section>
            <h4 className="mb-1 text-[12px] font-semibold text-muted">Answers ({data.answers.length})</h4>
            <div className="space-y-2">
              {data.answers.filter((a) => a.answer).map((a) => (
                <div key={a.question} className="rounded-md border border-line p-2">
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-[12px] font-medium">{a.question}</span>
                    <IconButton label="Copy answer" className="size-6" onClick={() => copy(a.answer, "Answer")}><Copy className="size-3" /></IconButton>
                  </div>
                  <p className="line-clamp-3 text-[12px] text-muted">{a.answer}</p>
                  {!a.approved && <Badge tone="warn">not approved</Badge>}
                </div>
              ))}
              {!data.answers.length && <Link href={`/jobs/${jobId}?tab=answers`} className="text-[12.5px] text-accent">Generate answers →</Link>}
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}
