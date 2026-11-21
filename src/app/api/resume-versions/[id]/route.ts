import { body, check, HttpError, must, route } from "@/lib/api";
import type { TailoredResume } from "@/lib/resume/tailor";
import { ALL_SECTIONS } from "@/lib/resume/tailor";
import { profileSkillSet, canonicalSkill } from "@/lib/skills";

export const GET = route<{ id: string }>(async (c, _req, { id }) => {
  const v = must(check(await c.db.from("resume_versions").select("*").eq("user_id", c.userId).eq("id", id).maybeSingle()), "Resume version not found");
  const ctx = await c.context();
  return { version: v, master: ctx.profile };
});

/**
 * Save manual edits. Edits are the user's own words, so they are accepted, but we still warn when the
 * edited resume mentions skills that are not in the master profile.
 */
export const PUT = route<{ id: string }>(async (c, req, { id }) => {
  const b = await body<{ content: TailoredResume; note?: string }>(req);
  const cur = must(check(await c.db.from("resume_versions").select("generated_content, history").eq("user_id", c.userId).eq("id", id).maybeSingle()), "Resume version not found");
  if (!b.content?.header || !Array.isArray(b.content.experience)) throw new HttpError(400, "invalid resume content");
  b.content.section_order = b.content.section_order.filter((s) => ALL_SECTIONS.includes(s));
  const history = [...((cur.history as unknown[]) ?? []), { at: new Date().toISOString(), content: cur.generated_content, note: b.note ?? "edit" }].slice(-30);
  const ctx = await c.context();
  const { explicit, evidenced } = profileSkillSet(ctx.profile);
  const have = new Set([...explicit, ...evidenced].map((s) => s.toLowerCase()));
  const unverified = b.content.skills.flatMap((g) => g.items).filter((s) => !have.has(canonicalSkill(s).toLowerCase()) && !have.has(s.toLowerCase()));
  check(await c.db.from("resume_versions").update({ generated_content: b.content, history }).eq("id", id).eq("user_id", c.userId));
  return { ok: true, warnings: unverified.length ? [`These skills are not in your master profile: ${unverified.join(", ")}. Add them to your profile if they are true.`] : [] };
});

export const DELETE = route<{ id: string }>(async (c, _req, { id }) => {
  check(await c.db.from("resume_versions").delete().eq("id", id).eq("user_id", c.userId));
  return { ok: true };
});
