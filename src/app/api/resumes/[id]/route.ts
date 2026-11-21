import { body, check, must, route } from "@/lib/api";
import type { CareerProfile } from "@/lib/types";

export const PATCH = route<{ id: string }>(async (c, req, { id }) => {
  const b = await body<{ is_primary?: boolean; apply_to_profile?: boolean }>(req);
  const r = must(check(await c.db.from("resumes").select("id, extracted_data").eq("user_id", c.userId).eq("id", id).maybeSingle()));
  if (b.is_primary) {
    await c.db.from("resumes").update({ is_primary: false }).eq("user_id", c.userId);
    await c.db.from("resumes").update({ is_primary: true }).eq("id", id);
  }
  if (b.apply_to_profile) check(await c.db.from("user_profiles").update({ profile_data: r.extracted_data as CareerProfile }).eq("user_id", c.userId));
  return { ok: true };
});

export const DELETE = route<{ id: string }>(async (c, _req, { id }) => {
  const r = must(check(await c.db.from("resumes").select("id, original_file_path").eq("user_id", c.userId).eq("id", id).maybeSingle()));
  if (r.original_file_path) await c.db.storage.from("resumes").remove([r.original_file_path]);
  check(await c.db.from("resumes").delete().eq("id", id).eq("user_id", c.userId));
  return { ok: true };
});
