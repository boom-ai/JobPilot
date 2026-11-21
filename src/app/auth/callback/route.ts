import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/clients";

/** Magic-link / OAuth code exchange. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const next = u.searchParams.get("next") ?? "/";
  if (code) {
    const db = await serverClient();
    await db.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", u.origin));
}
