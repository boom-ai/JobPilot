import { body, check, route } from "@/lib/api";

export const GET = route(async (c) => ({ notifications: check(await c.db.from("notifications").select("*").eq("user_id", c.userId).order("created_at", { ascending: false }).limit(100)) }));

export const PATCH = route(async (c, req) => {
  const b = await body<{ ids?: string[]; all?: boolean; read?: boolean }>(req);
  let q = c.db.from("notifications").update({ read: b.read ?? true }).eq("user_id", c.userId);
  if (!b.all) q = q.in("id", b.ids ?? []);
  check(await q);
  return { ok: true };
});

export const DELETE = route(async (c) => {
  check(await c.db.from("notifications").delete().eq("user_id", c.userId).eq("read", true));
  return { ok: true };
});
