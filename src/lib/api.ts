// Route-handler helpers: auth (session cookie or extension token), context, errors.
import { NextResponse } from "next/server";
import { adminClient, isLocalMode, serverClient, type DB } from "./supabase/clients";
import { LOCAL_USER_ID, localDb } from "./supabase/localdb";
import { loadUserContext, type UserContext } from "./agent/context";
import { seedDefaults } from "./agent/pipeline";
import { sha256 } from "./crypto";
import { DEFAULT_PREFERENCES, DEFAULT_SETTINGS } from "./defaults";
import { emptyProfile } from "./resume/parse";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface ApiCtx {
  db: DB;
  userId: string;
  email: string | null;
  via: "session" | "token" | "local";
  /** client that may read user_secrets (service role or local db); null if not configured */
  secretsDb: DB | null;
  context: () => Promise<UserContext>;
}

function secretsClient(): DB | null {
  if (isLocalMode()) return localDb() as unknown as DB;
  try {
    return adminClient();
  } catch {
    return null;
  }
}

const seeded = new Set<string>();
async function ensureSeeded(db: DB, userId: string) {
  if (seeded.has(userId)) return;
  const { data } = await db.from("user_profiles").select("id").eq("user_id", userId).maybeSingle();
  if (!data) {
    await db.from("user_profiles").insert({ user_id: userId, profile_data: emptyProfile(), preferences: DEFAULT_PREFERENCES, settings: DEFAULT_SETTINGS });
  }
  await seedDefaults(db, userId);
  seeded.add(userId);
}

export async function authenticate(req: Request): Promise<ApiCtx> {
  const secretsDb = secretsClient();
  const mk = (db: DB, userId: string, email: string | null, via: ApiCtx["via"]): ApiCtx => {
    let cached: Promise<UserContext> | null = null;
    return { db, userId, email, via, secretsDb, context: () => (cached ??= loadUserContext(db, userId, secretsDb)) };
  };
  const authz = req.headers.get("authorization");
  if (authz?.startsWith("Bearer jp_")) {
    // Chrome extension personal access token
    const token = authz.slice(7);
    const db = isLocalMode() ? (localDb() as unknown as DB) : adminClient();
    const { data } = await db.from("api_tokens").select("id, user_id").eq("token_hash", sha256(token)).maybeSingle();
    if (!data) throw new HttpError(401, "Invalid extension token");
    await db.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
    return mk(db, data.user_id, null, "token");
  }
  if (isLocalMode()) {
    const db = localDb() as unknown as DB;
    await ensureSeeded(db, LOCAL_USER_ID);
    return mk(db, LOCAL_USER_ID, "local@jobpilot", "local");
  }
  const db = await serverClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "Not signed in");
  await ensureSeeded(db, data.user.id);
  return mk(db, data.user.id, data.user.email ?? null, "session");
}

type Handler<P> = (ctx: ApiCtx, req: Request, params: P) => Promise<unknown>;

export function route<P = Record<string, string>>(handler: Handler<P>) {
  return async (req: Request, routeCtx: { params: Promise<P> }) => {
    try {
      const ctx = await authenticate(req);
      const params = (await routeCtx?.params) ?? ({} as P);
      const out = await handler(ctx, req, params);
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true }, { headers: cors(req) });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : /not found/i.test((e as Error).message) ? 404 : 500;
      if (status === 500) console.error("[api]", e);
      return NextResponse.json({ error: (e as Error).message }, { status, headers: cors(req) });
    }
  };
}

/** CORS for the Chrome extension only (chrome-extension:// origins). */
export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  if (origin.startsWith("chrome-extension://")) {
    return { "access-control-allow-origin": origin, "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, PATCH, OPTIONS", vary: "origin" };
  }
  return {};
}

export function preflight(req: Request) {
  return new Response(null, { status: 204, headers: cors(req) });
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

export function must<T>(v: T, msg = "Not found"): NonNullable<T> {
  if (v == null) throw new HttpError(404, msg);
  return v as NonNullable<T>;
}

export function check<T>(r: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (r.error) throw new Error(r.error.message);
  return r.data as NonNullable<T>;
}

export function fileResponse(data: Uint8Array | Buffer, filename: string, type: string, req?: Request) {
  return new Response(new Uint8Array(data), {
    headers: { "content-type": type, "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"`, "cache-control": "no-store", ...(req ? cors(req) : {}) },
  });
}
