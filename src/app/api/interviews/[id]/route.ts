import { body, check, route } from "@/lib/api";

export const PATCH = route<{ id: string }>(async (c, req, { id }) => {
  const b = await body<Record<string, unknown>>(req);
  const patch = Object.fromEntries(Object.entries(b).filter(([k]) => ["scheduled_at", "round", "interview_type", "details", "notes", "status"].includes(k)));
  return check(await c.db.from("interviews").update(patch).eq("id", id).eq("user_id", c.userId).select("*").single());
});

export const DELETE = route<{ id: string }>(async (c, _req, { id }) => {
  check(await c.db.from("interviews").delete().eq("id", id).eq("user_id", c.userId));
  return { ok: true };
});
