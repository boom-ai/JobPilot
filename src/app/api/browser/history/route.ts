import { body, check, HttpError, route } from "@/lib/api";

export const GET = route(async (c) => ({ history: check(await c.db.from("browser_history").select("*").eq("user_id", c.userId).order("visited_at", { ascending: false }).limit(200)) }));
export const POST = route(async (c, req) => {
  const b = await body<{ url: string; title?: string; job_id?: string | null }>(req);
  if (!/^https?:\/\//.test(b.url ?? "")) throw new HttpError(400, "valid url required");
  return check(await c.db.from("browser_history").insert({ user_id: c.userId, url: b.url, title: b.title ?? null, job_id: b.job_id ?? null }).select("*").single());
});
export const DELETE = route(async (c) => {
  check(await c.db.from("browser_history").delete().eq("user_id", c.userId));
  return { ok: true };
});
