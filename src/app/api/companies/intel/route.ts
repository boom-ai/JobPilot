import { body, check, HttpError, route } from "@/lib/api";
import { companyIntel } from "@/lib/ai/tasks";
import { normalizeCompany } from "@/lib/text";
import { upsertCompany } from "@/lib/agent/records";

/** Research a company. Verified facts carry sources; everything else is labelled as inference. */
export const POST = route(async (c, req) => {
  const b = await body<{ name: string }>(req);
  if (!b.name?.trim()) throw new HttpError(400, "name required");
  const ctx = await c.context();
  const jobs = check(await c.db.from("jobs").select("title, location, description").eq("user_id", c.userId).ilike("company", b.name.trim()).limit(5)) ?? [];
  const text = jobs.map((j: { title: string; location: string | null; description: string | null }) => `TITLE: ${j.title}\nLOCATION: ${j.location ?? ""}\n${(j.description ?? "").slice(0, 700)}`).join("\n---\n");
  const intel = await companyIntel(ctx.ai, b.name.trim(), text, ctx.settings.ai.grounded_company_research);
  await upsertCompany(c.db, c.userId, b.name.trim());
  check(await c.db.from("companies").update({ company_data: { intel }, website: intel.website, industry: intel.industry, updated_at: new Date().toISOString() }).eq("user_id", c.userId).eq("normalized_name", normalizeCompany(b.name.trim()) || b.name.trim().toLowerCase()));
  return { intel };
});
