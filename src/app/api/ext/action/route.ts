import { body, HttpError, preflight, route } from "@/lib/api";
import { analyzeJob, createTailoredResume, prepareApplication, createAnswers } from "@/lib/agent/services";
import { setApplicationStatus } from "@/lib/agent/records";
import { extensionContext } from "@/lib/ext";

export const OPTIONS = preflight;

/** Extension buttons: analyze | tailor | prepare | answers | shortlist */
export const POST = route(async (c, req) => {
  const b = await body<{ job_id: string; action: string; questions?: string[] }>(req);
  if (!b.job_id) throw new HttpError(400, "job_id required");
  const ctx = await c.context();
  switch (b.action) {
    case "analyze":
      await analyzeJob(c.db, ctx, b.job_id);
      break;
    case "tailor":
      await createTailoredResume(c.db, ctx, b.job_id);
      break;
    case "prepare":
      await prepareApplication(c.db, ctx, b.job_id, { forceMode: "manual" });
      break;
    case "answers":
      await createAnswers(c.db, ctx, b.job_id, b.questions?.slice(0, 25));
      break;
    case "shortlist":
      await setApplicationStatus(c.db, c.userId, b.job_id, "shortlisted", { onlyForward: true });
      break;
    default:
      throw new HttpError(400, "unknown action");
  }
  return extensionContext(c.db, await c.context(), b.job_id);
});
