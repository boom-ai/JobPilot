// Supabase clients.
//  - serverClient(): per-request, uses the signed-in user's session (RLS enforced)
//  - adminClient(): service role, server/worker only (bypasses RLS — always filter by user_id)
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isLocalMode, localDb } from "./localdb";

export type DB = SupabaseClient;
export { isLocalMode };

export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  return { url, anon };
}

export async function serverClient(): Promise<DB> {
  if (isLocalMode()) return localDb() as unknown as DB;
  const { cookies } = await import("next/headers");
  const store = await cookies();
  const { url, anon } = supabaseEnv();
  return createServerClient(url, anon, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) store.set(c.name, c.value, c.options);
        } catch {
          /* called from a Server Component — proxy refreshes the session */
        }
      },
    },
  });
}

let admin: DB | null = null;
export function adminClient(): DB {
  if (isLocalMode()) return localDb() as unknown as DB;
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for background processing.");
  admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

/** Client authenticated as a user via a raw access token (used by the extension bridge). */
export function tokenClient(accessToken: string): DB {
  const { url, anon } = supabaseEnv();
  return createClient(url, anon, { global: { headers: { Authorization: `Bearer ${accessToken}` } }, auth: { persistSession: false } });
}
