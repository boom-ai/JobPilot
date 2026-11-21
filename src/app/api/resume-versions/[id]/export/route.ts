import { check, fileResponse, must, route } from "@/lib/api";
import { resumeToDocx, resumeToPdf } from "@/lib/resume/export";
import type { TailoredResume } from "@/lib/resume/tailor";

export const GET = route<{ id: string }>(async (c, req, { id }) => {
  const fmt = new URL(req.url).searchParams.get("format") === "docx" ? "docx" : "pdf";
  const v = must(check(await c.db.from("resume_versions").select("generated_content, file_name").eq("user_id", c.userId).eq("id", id).maybeSingle()), "Resume version not found");
  const content = v.generated_content as TailoredResume;
  const name = `${v.file_name ?? "Resume"}.${fmt}`;
  if (fmt === "docx") return fileResponse(await resumeToDocx(content), name, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", req);
  return fileResponse(await resumeToPdf(content), name, "application/pdf", req);
});
