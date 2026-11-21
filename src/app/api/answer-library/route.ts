import { body, check, HttpError, route } from "@/lib/api";

export const GET = route(async (c) => ({ items: check(await c.db.from("answer_library").select("*").eq("user_id", c.userId).order("category")) }));

export const POST = route(async (c, req) => {
  const b = await body<{ key?: string; question: string; answer: string; category?: string; verified?: boolean }>(req);
  if (!b.question?.trim()) throw new HttpError(400, "question required");
  const key = b.key?.trim() || `custom_${b.question.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 50)}`;
  return check(await c.db.from("answer_library").upsert({ user_id: c.userId, key, question: b.question.trim(), answer: (b.answer ?? "").trim(), category: b.category ?? "general", verified: b.verified ?? true, updated_at: new Date().toISOString() }, { onConflict: "user_id,key" }).select("*").single());
});

export const DELETE = route(async (c, req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "id required");
  check(await c.db.from("answer_library").delete().eq("id", id).eq("user_id", c.userId));
  return { ok: true };
});
