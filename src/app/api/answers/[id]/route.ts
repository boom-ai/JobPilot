import { body, check, route } from "@/lib/api";
import { questionKey } from "@/lib/ai/tasks";

/** Edit/approve an answer. `save_to_library` stores it as a verified reusable answer. */
export const PATCH = route<{ id: string }>(async (c, req, { id }) => {
  const b = await body<{ answer?: string; approved?: boolean; save_to_library?: boolean }>(req);
  const patch: Record<string, unknown> = {};
  if (b.answer !== undefined) patch.answer = String(b.answer).slice(0, 5000);
  if (b.approved !== undefined) patch.approved = !!b.approved;
  if (b.answer !== undefined && b.approved === undefined) patch.flags = [];
  const row = check(await c.db.from("application_answers").update(patch).eq("id", id).eq("user_id", c.userId).select("*").single());
  if (b.save_to_library) {
    const key = questionKey(row.question) ?? `custom_${row.question.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 50)}`;
    await c.db.from("answer_library").upsert({ user_id: c.userId, key, question: row.question, answer: row.answer, category: "saved", verified: true, updated_at: new Date().toISOString() }, { onConflict: "user_id,key" });
  }
  return row;
});

export const DELETE = route<{ id: string }>(async (c, _req, { id }) => {
  check(await c.db.from("application_answers").delete().eq("id", id).eq("user_id", c.userId));
  return { ok: true };
});
