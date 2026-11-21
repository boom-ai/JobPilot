import { body, check, HttpError, route } from "@/lib/api";

export const GET = route(async (c) => ({ bookmarks: check(await c.db.from("bookmarks").select("*").eq("user_id", c.userId).order("created_at")) }));
export const POST = route(async (c, req) => {
  const b = await body<{ title: string; url: string }>(req);
  if (!/^https?:\/\//.test(b.url ?? "")) throw new HttpError(400, "valid url required");
  return check(await c.db.from("bookmarks").upsert({ user_id: c.userId, title: (b.title || b.url).slice(0, 120), url: b.url }, { onConflict: "user_id,url" }).select("*").single());
});
export const DELETE = route(async (c, req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "id required");
  check(await c.db.from("bookmarks").delete().eq("id", id).eq("user_id", c.userId));
  return { ok: true };
});
