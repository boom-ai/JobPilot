import { check, fileResponse, HttpError, preflight, route } from "@/lib/api";
import { resumeToPdf, resumeToDocx } from "@/lib/resume/export";
import type { TailoredResume } from "@/lib/resume/tailor";

export const OPTIONS = preflight;

/** Latest tailored resume for a job, as a file the extension can attach to an upload field. */
export const GET = route(async (c, req) => {
  const u = new URL(req.url);
  const jobId = u.searchParams.get("job_id");
  if (!jobId) throw new HttpError(400, "job_id required");
  const v = check(await c.db.from("resume_versions").select("generated_content, file_name").eq("user_id", c.userId).eq("job_id", jobId).order("version", { ascending: false }).limit(1))?.[0];
  if (!v) throw new HttpError(404, "No tailored resume yet — click Tailor Resume first.");
  const content = v.generated_content as TailoredResume;
  if (u.searchParams.get("format") === "docx") return fileResponse(await resumeToDocx(content), `${v.file_name}.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", req);
  return fileResponse(await resumeToPdf(content), `${v.file_name}.pdf`, "application/pdf", req);
});
