import { body, check, route } from "@/lib/api";

export const PUT = route<{ id: string }>(async (c, req, { id }) => {
  const b = await body<{ content: string }>(req);
  const row = check(await c.db.from("cover_letters").update({ content: String(b.content ?? "").slice(0, 20000) }).eq("id", id).eq("user_id", c.userId).select("id, job_id, kind, content").single());
  if (row.kind === "cover_letter") await c.db.from("applications").update({ cover_letter: row.content }).eq("user_id", c.userId).eq("cover_letter_id", id);
  return row;
});

export const DELETE = route<{ id: string }>(async (c, _req, { id }) => {
  check(await c.db.from("cover_letters").delete().eq("id", id).eq("user_id", c.userId));
  return { ok: true };
});
