"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity, BarChart3, Bell, Briefcase, CalendarClock, FileText, Globe, LayoutDashboard, ListChecks, LogOut, Moon, OctagonX,
  PanelLeft, PanelLeftClose, Pause, Play, Search, Settings, Sparkles, Star, Sun, Building2, Command,
} from "lucide-react";
import { api, post, patch, timeAgo, usePoll } from "@/lib/client";
import { Badge, cn, IconButton, Kbd, Modal, Button, useToast, ToastProvider } from "./ui";
import { browserClient } from "@/lib/supabase/browser";

export interface Me {
  user: { id: string; email: string | null };
  local_mode: boolean;
  app_name: string;
  ai: { configured: boolean; provider: string; model: string };
  has_profile: boolean;
  profile_name: string;
  agent_state: "running" | "paused" | "stopped";
  unread_notifications: number;
  awaiting_approval: number;
  secrets_storage: boolean;
}

const MeCtx = createContext<{ me: Me | null; refresh: () => void }>({ me: null, refresh: () => {} });
export const useMe = () => useContext(MeCtx);

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, key: "g d" },
  { href: "/discover", label: "Discover Jobs", icon: Search, key: "g j" },
  { href: "/matches", label: "AI Matches", icon: Sparkles, key: "g m" },
  { href: "/shortlist", label: "Shortlist", icon: Star, key: "g s" },
  { href: "/queue", label: "Application Queue", icon: ListChecks, key: "g q", badge: "awaiting_approval" as const },
  { href: "/applications", label: "Applications", icon: Briefcase, key: "g a" },
  { href: "/resume", label: "Resume Studio", icon: FileText, key: "g r" },
  { href: "/browser", label: "Browser Workspace", icon: Globe, key: "g b" },
  { href: "/interviews", label: "Interview Center", icon: CalendarClock, key: "g i" },
  { href: "/activity", label: "AI Agent Activity", icon: Activity, key: "g t" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, key: "g y" },
  { href: "/settings", label: "Settings", icon: Settings, key: "g ," },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ShellInner>{children}</ShellInner>
    </ToastProvider>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const refresh = useCallback(() => {
    api<Me>("/api/me").then(setMe).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    try {
      setCollapsed(localStorage.getItem("jp.sidebar") === "1");
    } catch {}
  }, [refresh]);
  usePoll(refresh, 20000, pathname !== "/login");

  // keyboard: ⌘K palette, g+key navigation
  useEffect(() => {
    let pending = "";
    let timer: ReturnType<typeof setTimeout>;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "/" ) {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      pending = pending ? `${pending} ${e.key}` : e.key;
      const hit = NAV.find((n) => n.key === pending);
      if (hit) {
        router.push(hit.href);
        pending = "";
      }
      clearTimeout(timer);
      timer = setTimeout(() => (pending = ""), 800);
      if (pending !== "g" && !NAV.some((n) => n.key.startsWith(pending))) pending = "";
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [router]);

  if (pathname === "/login") return <>{children}</>;

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("jp.sidebar", c ? "0" : "1");
      } catch {}
      return !c;
    });
  };

  return (
    <MeCtx.Provider value={{ me, refresh }}>
      <div className="flex h-dvh overflow-hidden">
        <aside className={cn("flex shrink-0 flex-col border-r border-line bg-bg transition-[width] duration-200", collapsed ? "w-[52px]" : "w-[228px]")}>
          <div className="flex h-12 items-center gap-2 px-3">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-[11px] font-bold text-accent-fg">JP</div>
            {!collapsed && <span className="truncate text-[13.5px] font-semibold">{me?.app_name ?? "Job Pilot AI"}</span>}
          </div>
          <nav className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-2 py-1" aria-label="Main">
            {NAV.map((n) => {
              const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              const count = n.badge && me ? me[n.badge] : 0;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  title={collapsed ? n.label : `${n.label}  (${n.key})`}
                  className={cn("group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors", active ? "bg-subtle text-fg font-medium" : "text-muted hover:bg-subtle hover:text-fg")}
                >
                  <n.icon className={cn("size-4 shrink-0", active ? "text-accent" : "")} />
                  {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
                  {!collapsed && count ? <Badge tone="warn">{count}</Badge> : null}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-line p-2">
            <button onClick={toggle} className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-muted hover:bg-subtle hover:text-fg" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
              {!collapsed && "Collapse"}
            </button>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar me={me} onSearch={() => setPaletteOpen(true)} refresh={refresh} />
          <main className="scroll-thin flex-1 overflow-y-auto">
            {me && !me.has_profile && !pathname.startsWith("/resume") && !pathname.startsWith("/settings") && (
              <div className="mx-auto max-w-[1400px] px-6 pt-4">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent-soft px-4 py-2.5 text-[13px]">
                  <span>Start by uploading your resume — matching, tailoring and applications use it as the source of truth.</span>
                  <Link href="/resume" className="font-medium text-accent hover:underline">Open Resume Studio →</Link>
                </div>
              </div>
            )}
            <div className="mx-auto max-w-[1400px] px-6 py-5">{children}</div>
          </main>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </MeCtx.Provider>
  );
}

function TopBar({ me, onSearch, refresh }: { me: Me | null; onSearch: () => void; refresh: () => void }) {
  const toast = useToast();
  const [dark, setDark] = useState(true);
  const [stopOpen, setStopOpen] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggleTheme = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("jp.theme", next ? "dark" : "light");
    } catch {}
    setDark(next);
  };
  const setState = async (action: "pause" | "resume" | "stop") => {
    try {
      await post("/api/agent", { action });
      toast(action === "stop" ? "Emergency stop: all agent tasks cancelled" : action === "pause" ? "Agent paused" : "Agent running", action === "stop" ? "bad" : "ok");
      refresh();
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };
  const state = me?.agent_state ?? "running";
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
      <button onClick={onSearch} className="flex h-8 w-full max-w-md items-center gap-2 rounded-md border border-line bg-subtle px-2.5 text-[13px] text-faint hover:border-line-strong">
        <Search className="size-3.5" />
        <span className="flex-1 text-left">Search jobs, companies, applications…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <div className="ml-auto flex items-center gap-1.5">
        {me && !me.ai.configured && (
          <Link href="/settings?tab=ai" className="hidden md:block">
            <Badge tone="warn" title="Matching, tailoring and letters work without AI using rule-based engines. Add a key for AI rewriting.">AI not configured</Badge>
          </Link>
        )}
        {me?.local_mode && <Badge tone="info" title="Running without Supabase — data stored in .jobpilot-local on this machine">Local mode</Badge>}
        <div className="flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5">
          <span className={cn("size-1.5 rounded-full", state === "running" ? "bg-ok animate-pulse" : state === "paused" ? "bg-warn" : "bg-bad")} />
          <Link href="/activity" className="px-1 text-[12px] text-muted hover:text-fg">Agent {state}</Link>
          {state === "running" ? (
            <IconButton label="Pause agent" onClick={() => setState("pause")}><Pause className="size-3.5" /></IconButton>
          ) : (
            <IconButton label="Resume agent" onClick={() => setState("resume")}><Play className="size-3.5" /></IconButton>
          )}
          <IconButton label="Emergency stop — cancel all agent tasks" className="text-bad hover:text-bad" onClick={() => setStopOpen(true)}>
            <OctagonX className="size-4" />
          </IconButton>
        </div>
        <Notifications count={me?.unread_notifications ?? 0} onChange={refresh} />
        <IconButton label={dark ? "Light mode" : "Dark mode"} onClick={toggleTheme}>
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </IconButton>
        {!me?.local_mode && (
          <IconButton
            label="Sign out"
            onClick={async () => {
              await browserClient()?.auth.signOut();
              window.location.href = "/login";
            }}
          >
            <LogOut className="size-4" />
          </IconButton>
        )}
      </div>
      <Modal
        open={stopOpen}
        onClose={() => setStopOpen(false)}
        title="Emergency stop"
        footer={
          <>
            <Button onClick={() => setStopOpen(false)}>Cancel</Button>
            <Button variant="danger" icon={<OctagonX className="size-3.5" />} onClick={() => { setStopOpen(false); setState("stop"); }}>Stop everything</Button>
          </>
        }
      >
        <p className="text-[13px] text-muted">This immediately cancels every pending, running and waiting agent task (searches, tailoring, form filling and submissions) and stops the agent until you resume it. A browser worker in the middle of a form will abort before submitting.</p>
      </Modal>
    </header>
  );
}

interface Notification {
  id: string;
  type: string;
  title: string;
  content: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

function Notifications({ count, onChange }: { count: number; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const load = useCallback(() => api<{ notifications: Notification[] }>("/api/notifications").then((r) => setItems(r.notifications)).catch(() => {}), []);
  useEffect(() => {
    if (open) load();
  }, [open, load]);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const markAll = async () => {
    await patch("/api/notifications", { all: true, read: true });
    load();
    onChange();
  };
  return (
    <div ref={ref} className="relative">
      <IconButton label="Notifications" onClick={() => setOpen((o) => !o)}>
        <Bell className="size-4" />
        {count > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-fg">{count > 99 ? "99+" : count}</span>}
      </IconButton>
      {open && (
        <div className="fade-in absolute right-0 top-9 z-50 w-[380px] rounded-lg border border-line bg-elev shadow-xl">
          <div className="flex h-10 items-center justify-between border-b border-line px-3">
            <span className="font-semibold">Notifications</span>
            <Button size="sm" variant="ghost" onClick={markAll}>Mark all read</Button>
          </div>
          <div className="scroll-thin max-h-[420px] overflow-y-auto">
            {!items ? (
              <div className="p-4 text-muted">Loading…</div>
            ) : !items.length ? (
              <div className="p-6 text-center text-muted">No notifications yet.</div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={async () => {
                    if (!n.read) await patch("/api/notifications", { ids: [n.id], read: true });
                    onChange();
                    setOpen(false);
                    if (n.link) router.push(n.link);
                  }}
                  className={cn("block w-full border-b border-line px-3 py-2.5 text-left hover:bg-subtle", !n.read && "bg-accent-soft/40")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className={cn("text-[13px]", !n.read && "font-medium")}>{n.title}</span>
                    <span className="shrink-0 text-[11px] text-faint">{timeAgo(n.created_at)}</span>
                  </div>
                  {n.content && <p className="mt-0.5 whitespace-pre-line text-[12px] text-muted line-clamp-3">{n.content}</p>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface SearchResult {
  jobs: { id: string; title: string; company: string; location: string | null; match_score: number | null }[];
  companies: { id: string; name: string; industry: string | null }[];
  applications: { id: string; job_id: string; application_status: string; jobs: { title: string; company: string } }[];
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResult | null>(null);
  const [sel, setSel] = useState(0);
  const router = useRouter();
  useEffect(() => {
    if (!open) {
      setQ("");
      setRes(null);
      setSel(0);
    }
  }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setRes(null);
      return;
    }
    const t = setTimeout(() => api<SearchResult>(`/api/global-search?q=${encodeURIComponent(q)}`).then(setRes).catch(() => {}), 160);
    return () => clearTimeout(t);
  }, [q]);
  const items: { label: string; sub?: string; href: string; group: string }[] = [
    ...(res?.jobs ?? []).map((j) => ({ group: "Jobs", label: j.title, sub: `${j.company}${j.location ? ` · ${j.location}` : ""}${j.match_score != null ? ` · ${j.match_score}` : ""}`, href: `/jobs/${j.id}` })),
    ...(res?.applications ?? []).map((a) => ({ group: "Applications", label: `${a.jobs.title} — ${a.jobs.company}`, sub: a.application_status.replace(/_/g, " "), href: `/jobs/${a.job_id}` })),
    ...(res?.companies ?? []).map((c) => ({ group: "Companies", label: c.name, sub: c.industry ?? undefined, href: `/discover?q=${encodeURIComponent(c.name)}` })),
    ...(q.trim().length < 2 ? NAV.map((n) => ({ group: "Go to", label: n.label, sub: n.key, href: n.href })) : NAV.filter((n) => n.label.toLowerCase().includes(q.toLowerCase())).map((n) => ({ group: "Go to", label: n.label, sub: n.key, href: n.href }))),
  ];
  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  return (
    <Modal open={open} onClose={onClose} title={<span className="flex items-center gap-2"><Command className="size-4" /> Search</span>}>
      <input
        autoFocus
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((s) => Math.min(s + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => Math.max(s - 1, 0));
          } else if (e.key === "Enter" && items[sel]) go(items[sel].href);
        }}
        placeholder="Type a job title, company, or page…"
        className="mb-3 h-10 w-full rounded-md border border-line bg-subtle px-3 text-[14px] outline-none focus:border-accent"
      />
      <div className="space-y-0.5">
        {items.map((it, i) => (
          <div key={`${it.group}${it.href}${i}`}>
            {(i === 0 || items[i - 1].group !== it.group) && <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-faint">{it.group}</div>}
            <button onMouseEnter={() => setSel(i)} onClick={() => go(it.href)} className={cn("flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left", sel === i ? "bg-subtle" : "")}>
              <span className="flex items-center gap-2 truncate">
                {it.group === "Companies" && <Building2 className="size-3.5 text-faint" />}
                {it.label}
              </span>
              {it.sub && <span className="truncate text-[12px] text-faint">{it.sub}</span>}
            </button>
          </div>
        ))}
        {q.trim().length >= 2 && res && !res.jobs.length && !res.applications.length && !res.companies.length && <p className="px-2 py-3 text-muted">No matches for “{q}”.</p>}
      </div>
    </Modal>
  );
}
