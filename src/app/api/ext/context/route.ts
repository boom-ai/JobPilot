import { HttpError, preflight, route } from "@/lib/api";
import { extensionContext, findJobByUrl } from "@/lib/ext";

export const OPTIONS = preflight;
export const GET = route(async (c, req) => {
  const u = new URL(req.url);
  const jobId = u.searchParams.get("job_id") ?? (u.searchParams.get("url") ? await findJobByUrl(c.db, c.userId, u.searchParams.get("url")!) : null);
  if (!u.searchParams.get("url") && !u.searchParams.get("job_id")) throw new HttpError(400, "url or job_id required");
  if (!jobId) return { found: false };
  return { found: true, ...(await extensionContext(c.db, await c.context(), jobId)) };
});
