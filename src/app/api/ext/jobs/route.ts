import { body, HttpError, preflight, route } from "@/lib/api";
import { ingestJobs } from "@/lib/agent/pipeline";
import { enrich } from "@/lib/sources/adapters";
import { extensionContext, findJobByUrl } from "@/lib/ext";
import { htmlToText } from "@/lib/text";
import type { NormalizedJob } from "@/lib/types";

export const OPTIONS = preflight;

/** Save a job captured from the page you are viewing (LinkedIn, Naukri, Indeed, career pages…). */
export const POST = route(async (c, req) => {
  const b = await body<Partial<NormalizedJob> & { url: string; site?: string }>(req);
  if (!b.title || !b.company || !b.url) throw new HttpError(400, "title, company and url are required");
  const existing = await findJobByUrl(c.db, c.userId, b.url);
  const ctx = await c.context();
  if (existing) return { created: false, job_id: existing, ...(await extensionContext(c.db, ctx, existing)) };
  const job = enrich({
    title: b.title.slice(0, 300),
    company: b.company.slice(0, 200),
    location: b.location ?? null,
    description: (b.description ?? "").length > 50 ? String(b.description).slice(0, 60000) : htmlToText(String(b.description ?? "")),
    source: (b.site ?? "extension").toLowerCase().replace(/[^a-z0-9]/g, "") || "extension",
    source_url: b.url,
    apply_url: b.apply_url ?? b.url,
    external_job_id: b.external_job_id ?? null,
    salary_text: b.salary_text ?? null,
    remote_type: b.remote_type,
    company_logo: b.company_logo ?? null,
    posted_at: b.posted_at ?? null,
    easy_apply: b.easy_apply ?? null,
  });
  const r = await ingestJobs(c.db, ctx, [job], { applyPreferenceExclusions: false });
  const id = r.inserted[0]?.id ?? r.mergedInto[0];
  if (!id) throw new HttpError(422, `Not saved: ${r.excluded[0]?.reason ?? "unknown reason"}`);
  return { created: !!r.inserted.length, job_id: id, ...(await extensionContext(c.db, ctx, id)) };
});
