import { check, fileResponse, must, route } from "@/lib/api";
import { textToDocx, textToPdf } from "@/lib/resume/export";

export const GET = route<{ id: string }>(async (c, req, { id }) => {
  const fmt = new URL(req.url).searchParams.get("format");
  const l = must(check(await c.db.from("cover_letters").select("content, kind, jobs(company, title)").eq("user_id", c.userId).eq("id", id).maybeSingle()), "Letter not found");
  const job = (Array.isArray(l.jobs) ? l.jobs[0] : l.jobs) as { company: string; title: string } | null;
  const base = `${(job?.company ?? "Company").replace(/\W+/g, "_")}_${(job?.title ?? "Role").replace(/\W+/g, "_")}_${l.kind === "cover_letter" ? "CoverLetter" : l.kind}_${new Date().toISOString().slice(0, 10)}`;
  if (fmt === "docx") return fileResponse(await textToDocx(base, l.content), `${base}.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", req);
  if (fmt === "txt") return fileResponse(Buffer.from(l.content), `${base}.txt`, "text/plain; charset=utf-8", req);
  return fileResponse(await textToPdf(base, l.content), `${base}.pdf`, "application/pdf", req);
});
