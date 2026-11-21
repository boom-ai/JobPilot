import { check, route } from "@/lib/api";

export const POST = route<{ id: string }>(async (c, _req, { id }) => {
  check(await c.db.from("jobs").update({ duplicate_of: null }).eq("id", id).eq("user_id", c.userId));
  return { ok: true };
});
