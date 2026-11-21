import { check, must, route } from "@/lib/api";
import { interviewPrep, type CompanyIntel } from "@/lib/ai/tasks";
import { normalizeCompany } from "@/lib/text";
import type { NormalizedJob } from "@/lib/types";

export const POST = route<{ id: string }>(async (c, _req, { id }) => {
  const iv = must(check(await c.db.from("interviews").select("id, applications(job_id, jobs(*))").eq("user_id", c.userId).eq("id", id).maybeSingle()), "Interview not found");
  const app = (Array.isArray(iv.applications) ? iv.applications[0] : iv.applications) as { jobs: NormalizedJob | NormalizedJob[] };
  const job = (Array.isArray(app.jobs) ? app.jobs[0] : app.jobs) as NormalizedJob;
  const ctx = await c.context();
  const { data: company } = await c.db.from("companies").select("company_data").eq("user_id", c.userId).eq("normalized_name", normalizeCompany(job.company)).maybeSingle();
  const intel = (company?.company_data as { intel?: CompanyIntel })?.intel ?? null;
  const prep = await interviewPrep(ctx.ai, ctx.profile, job, intel);
  check(await c.db.from("interviews").update({ prep }).eq("id", id));
  return { prep };
});
