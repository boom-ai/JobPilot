// Local mode: a file-backed implementation of the subset of the supabase-js API this app uses.
// Enables zero-setup single-user use (`JOBPILOT_LOCAL_MODE=1`) and end-to-end tests without Supabase.
// Production / multi-device use should run on Supabase (Postgres + RLS + Auth + Storage).
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";

const UNIQUE: Record<string, string[][]> = {
  user_profiles: [["user_id"]],
  user_secrets: [["user_id"]],
  agent_state: [["user_id"]],
  companies: [["user_id", "normalized_name"]],
  jobs: [["user_id", "source", "external_job_id"]],
  job_sources: [["job_id", "source_name", "source_url"]],
  applications: [["user_id", "job_id"]],
  answer_library: [["user_id", "key"]],
  bookmarks: [["user_id", "url"]],
  api_tokens: [["token_hash"]],
};
const PK: Record<string, string> = { user_secrets: "user_id", agent_state: "user_id" };

const now = () => new Date().toISOString();
const DEFAULTS: Record<string, () => Row> = {
  user_profiles: () => ({ profile_data: {}, preferences: {}, settings: {}, created_at: now(), updated_at: now() }),
  resumes: () => ({ extracted_data: {}, resume_type: "uploaded", is_primary: false, created_at: now() }),
  companies: () => ({ company_data: {}, updated_at: now() }),
  saved_searches: () => ({ query: {}, filters: {}, sources: [], schedule: "manual", enabled: true, is_preset: false, created_at: now() }),
  jobs: () => ({ countries: [], skills: [], tags: [], hidden: false, discovered_at: now(), duplicate_of: null, match_score: null, match_analysis: null, ai_analysis: null, deadline: null }),
  job_sources: () => ({ created_at: now() }),
  resume_versions: () => ({ change_log: [], history: [], version: 1, created_at: now(), updated_at: now() }),
  cover_letters: () => ({ kind: "cover_letter", tone: "professional", flags: [], version: 1, created_at: now(), updated_at: now() }),
  applications: () => ({ application_status: "discovered", status_history: [], recruiter_details: {}, follow_up_date: null, applied_at: null, created_at: now(), updated_at: now() }),
  application_answers: () => ({ source: "ai", flags: [], approved: false, created_at: now() }),
  answer_library: () => ({ category: "general", verified: true, updated_at: now() }),
  interviews: () => ({ round: 1, details: {}, status: "scheduled", created_at: now() }),
  followups: () => ({ type: "follow_up", status: "pending", notified_at: null, created_at: now() }),
  agent_state: () => ({ state: "running", updated_at: now() }),
  agent_tasks: () => ({ status: "pending", payload: {}, logs: [], retry_count: 0, max_retries: 2, requires_browser: false, run_after: now(), created_at: now(), updated_at: now(), result: null, error: null }),
  agent_events: () => ({ data: {}, created_at: now() }),
  notifications: () => ({ read: false, created_at: now() }),
  bookmarks: () => ({ created_at: now() }),
  browser_history: () => ({ visited_at: now() }),
  api_tokens: () => ({ created_at: now(), last_used_at: null }),
};
const TOUCH_UPDATED = new Set(["user_profiles", "applications", "agent_tasks", "resume_versions", "cover_letters"]);
// FK cascades (parent table → [child table, fk column])
const CASCADE: Record<string, [string, string][]> = {
  jobs: [["job_sources", "job_id"], ["applications", "job_id"], ["resume_versions", "job_id"], ["cover_letters", "job_id"], ["application_answers", "job_id"], ["agent_tasks", "job_id"]],
  applications: [["application_answers", "application_id"], ["interviews", "application_id"], ["followups", "application_id"]],
};

class Store {
  tables: Tables = {};
  private mtime = 0;
  constructor(private file: string | null) {
    this.reload(true);
  }
  reload(force = false) {
    if (!this.file || !fs.existsSync(this.file)) return;
    const m = fs.statSync(this.file).mtimeMs;
    if (!force && m === this.mtime) return;
    this.tables = JSON.parse(fs.readFileSync(this.file, "utf8"));
    this.mtime = m;
  }
  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.tables));
    fs.renameSync(tmp, this.file);
    this.mtime = fs.statSync(this.file).mtimeMs;
  }
  t(name: string): Row[] {
    return (this.tables[name] ??= []);
  }
}

type Filter = (r: Row) => boolean;
type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function get(r: Row, col: string): unknown {
  return col.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Row)[k] : undefined), r);
}

function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

class Query implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: Row[] = [];
  private patch: Row = {};
  private cols = "*";
  private returning = false;
  private countMode = false;
  private head = false;
  private orders: { col: string; asc: boolean }[] = [];
  private lim: number | null = null;
  private off = 0;
  private mode: "many" | "single" | "maybe" = "many";
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};

  constructor(private db: LocalDB, private table: string) {}

  select(cols = "*", opts?: { count?: "exact"; head?: boolean }) {
    if (this.op === "select") this.cols = cols;
    else {
      this.returning = true;
      this.cols = cols;
    }
    if (opts?.count) this.countMode = true;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.upsertOpts = opts;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => get(r, c) === v || (v != null && get(r, c) != null && String(get(r, c)) === String(v)));
    return this;
  }
  neq(c: string, v: unknown) {
    this.filters.push((r) => get(r, c) !== v);
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(get(r, c)));
    return this;
  }
  gt(c: string, v: unknown) {
    this.filters.push((r) => get(r, c) != null && cmp(get(r, c), v) > 0);
    return this;
  }
  gte(c: string, v: unknown) {
    this.filters.push((r) => get(r, c) != null && cmp(get(r, c), v) >= 0);
    return this;
  }
  lt(c: string, v: unknown) {
    this.filters.push((r) => get(r, c) != null && cmp(get(r, c), v) < 0);
    return this;
  }
  lte(c: string, v: unknown) {
    this.filters.push((r) => get(r, c) != null && cmp(get(r, c), v) <= 0);
    return this;
  }
  is(c: string, v: null | boolean) {
    this.filters.push((r) => (v === null ? get(r, c) == null : get(r, c) === v));
    return this;
  }
  not(c: string, op: string, v: unknown) {
    if (op === "is") this.filters.push((r) => (v === null ? get(r, c) != null : get(r, c) !== v));
    else if (op === "eq") this.filters.push((r) => get(r, c) !== v);
    else if (op === "in") {
      const list = String(v).replace(/[()]/g, "").split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
      this.filters.push((r) => !list.includes(String(get(r, c))));
    }
    return this;
  }
  ilike(c: string, pattern: string) {
    const re = new RegExp("^" + pattern.split("%").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
    this.filters.push((r) => re.test(String(get(r, c) ?? "")));
    return this;
  }
  contains(c: string, vs: unknown[]) {
    this.filters.push((r) => Array.isArray(get(r, c)) && vs.every((v) => (get(r, c) as unknown[]).includes(v)));
    return this;
  }
  /** Supports "col.ilike.%x%,col2.eq.y" */
  or(expr: string) {
    const parts = splitTop(expr).map((p) => {
      const [col, op, ...rest] = p.split(".");
      const val = rest.join(".");
      return (r: Row) => {
        const v = get(r, col);
        if (op === "ilike") return new RegExp("^" + val.split("%").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i").test(String(v ?? ""));
        if (op === "eq") return String(v) === val;
        if (op === "is") return val === "null" ? v == null : String(v) === val;
        return false;
      };
    });
    this.filters.push((r) => parts.some((f) => f(r)));
    return this;
  }
  order(c: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    this.orders.push({ col: c, asc: o.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  range(a: number, b: number) {
    this.off = a;
    this.lim = b - a + 1;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }
  then<T1 = Result, T2 = never>(ok?: ((v: Result) => T1 | PromiseLike<T1>) | null, err?: ((e: unknown) => T2 | PromiseLike<T2>) | null): PromiseLike<T1 | T2> {
    let res: Result;
    try {
      res = this.exec();
    } catch (e) {
      res = { data: null, error: { message: (e as Error).message } };
    }
    return Promise.resolve(res).then(ok, err);
  }

  private uniqueViolation(row: Row, rows: Row[], except?: Row): string | null {
    for (const keys of UNIQUE[this.table] ?? []) {
      if (keys.some((k) => row[k] == null)) continue;
      if (rows.some((r) => r !== except && keys.every((k) => String(r[k]) === String(row[k])))) return keys.join(",");
    }
    return null;
  }

  private exec(): Result {
    const store = this.db.store;
    store.reload();
    const rows = store.t(this.table);
    let affected: Row[] = [];
    if (this.op === "insert" || this.op === "upsert") {
      const conflictKeys = this.upsertOpts.onConflict?.split(",").map((s) => s.trim()) ?? [PK[this.table] ?? "id"];
      for (const p of this.payload) {
        if (this.op === "upsert") {
          const hit = rows.find((r) => conflictKeys.every((k) => p[k] !== undefined && String(r[k]) === String(p[k])));
          if (hit) {
            if (!this.upsertOpts.ignoreDuplicates) {
              Object.assign(hit, structuredClone(p));
              if (TOUCH_UPDATED.has(this.table)) hit.updated_at = now();
              affected.push(hit);
            }
            continue;
          }
        }
        const row: Row = { ...(PK[this.table] ? {} : { id: randomUUID() }), ...(DEFAULTS[this.table]?.() ?? { created_at: now() }), ...structuredClone(p) };
        const v = this.uniqueViolation(row, rows);
        if (v) return { data: null, error: { message: `duplicate key value violates unique constraint (${this.table}: ${v})`, code: "23505" } };
        rows.push(row);
        affected.push(row);
      }
      store.save();
      if (!this.returning) return { data: null, error: null };
      return this.shape(affected);
    }
    const matched = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") {
      for (const r of matched) {
        const next = { ...r, ...structuredClone(this.patch) };
        const v = this.uniqueViolation(next, rows, r);
        if (v) return { data: null, error: { message: `duplicate key value violates unique constraint (${this.table}: ${v})`, code: "23505" } };
        Object.assign(r, structuredClone(this.patch));
        if (TOUCH_UPDATED.has(this.table)) r.updated_at = now();
      }
      store.save();
      return this.returning ? this.shape(matched) : { data: null, error: null };
    }
    if (this.op === "delete") {
      this.db.cascadeDelete(this.table, matched);
      store.save();
      return this.returning ? this.shape(matched) : { data: null, error: null };
    }
    return this.shape(matched);
  }

  private shape(input: Row[]): Result {
    let list = [...input];
    for (const o of [...this.orders].reverse()) list.sort((a, b) => (o.asc ? 1 : -1) * cmp(get(a, o.col), get(b, o.col)));
    // embeds first (so !inner can filter), then paginate
    list = list.map((r) => this.db.project(this.table, r, this.cols)).filter((r): r is Row => r !== null);
    const count = list.length;
    if (this.off) list = list.slice(this.off);
    if (this.lim != null) list = list.slice(0, this.lim);
    if (this.head) return { data: null, error: null, count };
    if (this.mode === "single") {
      if (list.length !== 1) return { data: null, error: { message: list.length ? "multiple rows returned" : "no rows returned", code: "PGRST116" } };
      return { data: list[0], error: null, count: this.countMode ? count : null };
    }
    if (this.mode === "maybe") return { data: list[0] ?? null, error: null };
    return { data: list, error: null, count: this.countMode ? count : null };
  }
}

export class LocalDB {
  store: Store;
  auth = {
    getUser: async () => ({ data: { user: { id: LOCAL_USER_ID, email: "local@jobpilot" } }, error: null }),
    getClaims: async () => ({ data: { claims: { sub: LOCAL_USER_ID } }, error: null }),
    signOut: async () => ({ error: null }),
  };
  storage: { from: (bucket: string) => { upload: (p: string, d: Uint8Array | Buffer | ArrayBuffer, o?: unknown) => Promise<{ data: { path: string } | null; error: null | { message: string } }>; download: (p: string) => Promise<{ data: Blob | null; error: null | { message: string } }>; remove: (ps: string[]) => Promise<{ data: null; error: null }> } };

  constructor(private dir: string | null) {
    this.store = new Store(dir ? path.join(dir, "db.json") : null);
    const fileDir = dir ? path.join(dir, "files") : null;
    const mem = new Map<string, Buffer>();
    this.storage = {
      from: (bucket: string) => ({
        upload: async (p, d) => {
          const buf = Buffer.from(d instanceof ArrayBuffer ? new Uint8Array(d) : d);
          if (fileDir) {
            const f = path.join(fileDir, bucket, p);
            fs.mkdirSync(path.dirname(f), { recursive: true });
            fs.writeFileSync(f, buf);
          } else mem.set(`${bucket}/${p}`, buf);
          return { data: { path: p }, error: null };
        },
        download: async (p) => {
          const buf = fileDir ? (fs.existsSync(path.join(fileDir, bucket, p)) ? fs.readFileSync(path.join(fileDir, bucket, p)) : null) : mem.get(`${bucket}/${p}`) ?? null;
          return buf ? { data: new Blob([new Uint8Array(buf)]), error: null } : { data: null, error: { message: "not found" } };
        },
        remove: async (ps) => {
          for (const p of ps) {
            if (fileDir) fs.rmSync(path.join(fileDir, bucket, p), { force: true });
            else mem.delete(`${bucket}/${p}`);
          }
          return { data: null, error: null };
        },
      }),
    };
  }

  from(table: string) {
    return new Query(this, table);
  }

  cascadeDelete(table: string, victims: Row[]) {
    const ids = new Set(victims.map((v) => v.id));
    this.store.tables[table] = this.store.t(table).filter((r) => !victims.includes(r));
    for (const [child, fk] of CASCADE[table] ?? []) {
      const kids = this.store.t(child).filter((r) => ids.has(r[fk]));
      if (kids.length) this.cascadeDelete(child, kids);
    }
    // ON DELETE SET NULL references
    for (const rows of Object.values(this.store.tables)) for (const r of rows) for (const k of ["resume_version_id", "cover_letter_id", "duplicate_of", "company_id"]) if (k in r && ids.has(r[k])) r[k] = null;
  }

  /** Apply a PostgREST-style select list incl. embedded resources like `jobs!inner(title, company)`. */
  project(table: string, row: Row, cols: string): Row | null {
    const fields = splitTop(cols.replace(/\s+/g, " "));
    const out: Row = {};
    for (const f of fields) {
      const m = /^([\w]+)(?:!(\w+))?\s*\((.*)\)$/.exec(f);
      if (m) {
        const [, rel, hint, inner] = m;
        const isInner = hint === "inner";
        const singular = rel.replace(/ies$/, "y").replace(/s$/, "");
        const fk = `${singular}_id`;
        if (fk in row) {
          const target = this.store.t(rel).find((r) => r.id === row[fk]);
          const proj = target ? this.project(rel, target, inner) : null;
          if (isInner && !proj) return null;
          out[rel] = proj;
        } else {
          const back = `${table.replace(/ies$/, "y").replace(/s$/, "")}_id`;
          const kids = this.store.t(rel).filter((r) => r[back] === row.id).map((k) => this.project(rel, k, inner)).filter(Boolean);
          if (isInner && !kids.length) return null;
          out[rel] = kids;
        }
      } else if (f === "*") Object.assign(out, structuredClone(row));
      else {
        const [name, alias] = f.split(":").map((s) => s.trim()).reverse();
        out[alias ?? name] = structuredClone(row[name] ?? null);
      }
    }
    return out;
  }
}

const instances = new Map<string, LocalDB>();
export function localDb(dir = process.env.JOBPILOT_LOCAL_DIR ?? path.join(process.cwd(), ".jobpilot-local")): LocalDB {
  let db = instances.get(dir);
  if (!db) {
    db = new LocalDB(dir);
    instances.set(dir, db);
  }
  return db;
}

export function memoryDb(): LocalDB {
  return new LocalDB(null);
}

export const isLocalMode = () => process.env.JOBPILOT_LOCAL_MODE === "1" || (!process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NODE_ENV !== "production");
