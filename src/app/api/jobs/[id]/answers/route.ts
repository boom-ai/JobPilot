import { body, route } from "@/lib/api";
import { createAnswers } from "@/lib/agent/services";

export const POST = route<{ id: string }>(async (c, req, { id }) => {
  const b = await body<{ questions?: string[] }>(req).catch(() => ({ questions: undefined }));
  const questions = (b.questions ?? []).map((q) => String(q).trim()).filter(Boolean).slice(0, 25);
  return { answers: await createAnswers(c.db, await c.context(), id, questions.length ? questions : undefined) };
});
