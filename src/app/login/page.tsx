"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { browserClient } from "@/lib/supabase/browser";
import { Button, Field, Input } from "@/components/ui";

export default function Page() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function Login() {
  const sp = useSearchParams();
  const next = sp.get("next") ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup" | "magic">("signin");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const sb = browserClient();

  if (!sb) {
    return (
      <Shell>
        <p className="text-[13px] text-muted">Supabase isn&apos;t configured, so Job Pilot is running in <b>local mode</b> (single user, data stored on this machine). No sign-in needed.</p>
        <Link href="/"><Button variant="primary" className="mt-4 w-full">Open Job Pilot</Button></Link>
      </Shell>
    );
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "magic") {
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` } });
        if (error) throw error;
        setMsg({ tone: "ok", text: "Check your email for a sign-in link." });
      } else if (mode === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/auth/callback` } });
        if (error) throw error;
        if (data.session) location.href = next;
        else setMsg({ tone: "ok", text: "Account created. Confirm your email, then sign in." });
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        location.href = next;
      }
    } catch (err) {
      setMsg({ tone: "bad", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Email"><Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
        {mode !== "magic" && <Field label="Password"><Input type="password" required minLength={8} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>}
        {msg && <p className={msg.tone === "ok" ? "text-[13px] text-ok" : "text-[13px] text-bad"}>{msg.text}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={busy}>{mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send magic link"}</Button>
      </form>
      <div className="mt-4 flex justify-between text-[12.5px] text-muted">
        <button onClick={() => setMode(mode === "signup" ? "signin" : "signup")} className="hover:text-fg">{mode === "signup" ? "Have an account? Sign in" : "Create an account"}</button>
        <button onClick={() => setMode(mode === "magic" ? "signin" : "magic")} className="hover:text-fg">{mode === "magic" ? "Use password" : "Email me a link"}</button>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-line bg-elev p-6 shadow-xl">
        <div className="mb-5 flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-accent text-[12px] font-bold text-accent-fg">JP</div>
          <span className="text-[15px] font-semibold">Job Pilot AI</span>
        </div>
        {children}
      </div>
    </div>
  );
}
