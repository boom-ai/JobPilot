import { body, check, HttpError, route } from "@/lib/api";

/** Manually merge duplicates: the duplicates are linked to the primary and their source links copied over. */
export const POST = route(async (c, req) => {
  const b = await body<{ primary_id: string; duplicate_ids: string[] }>(req);
  if (!b.primary_id || !b.duplicate_ids?.length) throw new HttpError(400, "primary_id and duplicate_ids required");
  const ids = b.duplicate_ids.filter((d) => d !== b.primary_id);
  const dups = check(await c.db.from("jobs").select("id, source, source_url, external_job_id").eq("user_id", c.userId).in("id", ids));
  for (const d of dups ?? []) {
    await c.db.from("job_sources").upsert({ user_id: c.userId, job_id: b.primary_id, source_name: d.source, source_url: d.source_url, external_job_id: d.external_job_id }, { onConflict: "job_id,source_name,source_url", ignoreDuplicates: true });
    await c.db.from("jobs").update({ duplicate_of: b.primary_id }).eq("id", d.id).eq("user_id", c.userId);
  }
  return { merged: dups?.length ?? 0 };
});
