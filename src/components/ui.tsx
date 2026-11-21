"use client";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { Loader2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import type { Recommendation } from "@/lib/types";

export const cn = (...a: Parameters<typeof clsx>) => twMerge(clsx(...a));

// ---------------------------------------------------------------------------
type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export function Button({ variant = "secondary", size = "md", loading, className, children, icon, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors select-none whitespace-nowrap disabled:opacity-50 disabled:pointer-events-none",
        size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-8 px-3 text-[13px]",
        variant === "primary" && "bg-accent text-accent-fg hover:brightness-110",
        variant === "secondary" && "bg-subtle text-fg border border-line hover:bg-hover",
        variant === "outline" && "border border-line text-fg hover:bg-subtle",
        variant === "ghost" && "text-muted hover:text-fg hover:bg-subtle",
        variant === "danger" && "bg-bad text-white hover:brightness-110",
        className,
      )}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button {...p} aria-label={label} title={label} className={cn("inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-fg disabled:opacity-40", className)}>
      {children}
    </button>
  );
}

export const inputCls = "h-8 w-full rounded-md border border-line bg-elev px-2.5 text-[13px] text-fg placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--ring)]";

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cn(inputCls, className)} />;
}

export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cn(inputCls, "h-auto min-h-[80px] py-2 leading-relaxed", className)} />;
}

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...p} className={cn(inputCls, "pr-7 appearance-none bg-[length:12px] bg-[right_8px_center] bg-no-repeat", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-[12px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-[11.5px] text-faint">{hint}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-[13px]", disabled && "opacity-50 cursor-not-allowed")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative h-[18px] w-8 rounded-full transition-colors", checked ? "bg-accent" : "bg-line-strong")}
      >
        <span className={cn("absolute top-[2px] size-[14px] rounded-full bg-white shadow transition-all", checked ? "left-[16px]" : "left-[2px]")} />
      </button>
      {label}
    </label>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-fg">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------------------
type Tone = "neutral" | "accent" | "ok" | "warn" | "bad" | "info";
export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11.5px] font-medium whitespace-nowrap",
        tone === "neutral" && "bg-subtle text-muted border border-line",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "ok" && "bg-ok-soft text-ok",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "bad" && "bg-bad-soft text-bad",
        tone === "info" && "bg-info-soft text-info",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function recTone(r?: Recommendation | null): Tone {
  return r === "Excellent" ? "ok" : r === "Strong" ? "info" : r === "Moderate" ? "warn" : "neutral";
}

export function scoreTone(s: number | null | undefined, th = { excellent: 90, strong: 80, moderate: 65 }): Tone {
  if (s == null) return "neutral";
  return s >= th.excellent ? "ok" : s >= th.strong ? "info" : s >= th.moderate ? "warn" : "neutral";
}

export function Score({ value, size = "md" }: { value: number | null | undefined; size?: "sm" | "md" | "lg" }) {
  const tone = scoreTone(value);
  const dim = size === "lg" ? 56 : size === "md" ? 34 : 26;
  const r = dim / 2 - 3;
  const c = 2 * Math.PI * r;
  const color = { ok: "var(--ok)", info: "var(--info)", warn: "var(--warn)", neutral: "var(--fg-faint)", accent: "var(--accent)", bad: "var(--bad)" }[tone];
  return (
    <div className="relative shrink-0" style={{ width: dim, height: dim }} title={value == null ? "Not scored yet" : `Match score ${value}/100`}>
      <svg width={dim} height={dim} className="-rotate-90">
        <circle cx={dim / 2} cy={dim / 2} r={r} stroke="var(--border)" strokeWidth={size === "lg" ? 4 : 3} fill="none" />
        {value != null && <circle cx={dim / 2} cy={dim / 2} r={r} stroke={color} strokeWidth={size === "lg" ? 4 : 3} fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} strokeLinecap="round" />}
      </svg>
      <span className={cn("absolute inset-0 flex items-center justify-center font-semibold tabular-nums", size === "lg" ? "text-[17px]" : size === "md" ? "text-[11.5px]" : "text-[10px]")}>{value ?? "–"}</span>
    </div>
  );
}

export function Bar({ value, label }: { value: number; label: string }) {
  const tone = scoreTone(value);
  const color = { ok: "bg-ok", info: "bg-info", warn: "bg-warn", neutral: "bg-faint", accent: "bg-accent", bad: "bg-bad" }[tone];
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[12px]">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums font-medium">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-subtle">
        <div className={cn("h-1.5 rounded-full transition-all", color)} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function Panel({ title, actions, children, className, bodyClass }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cn("rounded-lg border border-line bg-elev", className)}>
      {(title || actions) && (
        <header className="flex h-10 items-center justify-between gap-2 border-b border-line px-3.5">
          <h2 className="truncate text-[13px] font-semibold">{title}</h2>
          <div className="flex items-center gap-1">{actions}</div>
        </header>
      )}
      <div className={cn("p-3.5", bodyClass)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-10 text-center">
      {icon && <div className="mb-2 text-faint">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-md text-[13px] text-muted">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-muted", className)} />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-muted justify-center">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-[13px] text-bad">
      <span>{error}</span>
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-subtle px-1 font-mono text-[10.5px] text-muted">{children}</kbd>;
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cn("flex items-center gap-0.5 border-b border-line", className)}>
      {items.map((i) => (
        <button
          key={i.value}
          role="tab"
          aria-selected={value === i.value}
          onClick={() => onChange(i.value)}
          className={cn("relative -mb-px flex h-9 items-center gap-1.5 px-2.5 text-[13px] transition-colors", value === i.value ? "text-fg after:absolute after:inset-x-1 after:bottom-0 after:h-[2px] after:rounded after:bg-accent" : "text-muted hover:text-fg")}
        >
          {i.label}
          {i.count != null && <span className="rounded bg-subtle px-1 text-[11px] tabular-nums text-muted">{i.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; icon?: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-subtle p-0.5">
      {items.map((i) => (
        <button key={i.value} onClick={() => onChange(i.value)} className={cn("flex h-6 items-center gap-1 rounded px-2 text-[12.5px]", value === i.value ? "bg-elev text-fg shadow-sm" : "text-muted hover:text-fg")}>
          {i.icon}
          {i.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh] backdrop-blur-[1px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={cn("fade-in flex max-h-[80vh] w-full flex-col rounded-xl border border-line bg-elev shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")}>
        <div className="flex h-11 items-center justify-between border-b border-line px-4">
          <h3 className="font-semibold">{title}</h3>
          <IconButton label="Close" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="scroll-thin overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, children, width = 560 }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/25" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="slide-in scroll-thin h-full w-full overflow-y-auto border-l border-line bg-elev shadow-2xl" style={{ maxWidth: width }}>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
interface ToastItem {
  id: number;
  text: string;
  tone: "ok" | "bad" | "info";
}
const ToastCtx = createContext<(text: string, tone?: ToastItem["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const n = useRef(0);
  const push = useCallback((text: string, tone: ToastItem["tone"] = "ok") => {
    const id = ++n.current;
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === "bad" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={cn("fade-in pointer-events-auto max-w-sm rounded-lg border px-3 py-2 text-[13px] shadow-lg", i.tone === "bad" ? "border-bad/40 bg-bad-soft text-bad" : i.tone === "info" ? "border-line bg-elev text-fg" : "border-ok/30 bg-elev text-fg")}>
            {i.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Wrap an async action with loading state + toast on error/success. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, success?: string | ((r: T) => string | null)): Promise<T | undefined> => {
      setBusy(key);
      try {
        const r = await fn();
        const msg = typeof success === "function" ? success(r) : success;
        if (msg) toast(msg);
        return r;
      } catch (e) {
        toast((e as Error).message, "bad");
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { busy, run };
}

export function Stat({ label, value, sub, onClick, tone }: { label: string; value: ReactNode; sub?: ReactNode; onClick?: () => void; tone?: Tone }) {
  const C = onClick ? "button" : "div";
  return (
    <C onClick={onClick} className={cn("rounded-lg border border-line bg-elev px-3 py-2.5 text-left", onClick && "hover:border-line-strong hover:bg-subtle transition-colors")}>
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={cn("mt-0.5 text-[20px] font-semibold tabular-nums tracking-tight", tone === "ok" && "text-ok", tone === "bad" && "text-bad", tone === "warn" && "text-warn", tone === "accent" && "text-accent")}>{value}</div>
      {sub && <div className="text-[11.5px] text-faint">{sub}</div>}
    </C>
  );
}

export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setDraft("");
  };
  return (
    <div className={cn(inputCls, "flex h-auto min-h-8 flex-wrap items-center gap-1 py-1")}>
      {value.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded bg-subtle px-1.5 py-0.5 text-[12px]">
          {v}
          <button type="button" aria-label={`Remove ${v}`} className="text-faint hover:text-fg" onClick={() => onChange(value.filter((x) => x !== v))}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={add}
        placeholder={value.length ? "" : placeholder}
        className="min-w-[100px] flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
      />
    </div>
  );
}
