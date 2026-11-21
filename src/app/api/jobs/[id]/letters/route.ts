import { body, HttpError, route } from "@/lib/api";
import { createLetter } from "@/lib/agent/services";
import type { LetterKind } from "@/lib/ai/tasks";

const KINDS: LetterKind[] = ["cover_letter", "intro", "recruiter", "linkedin", "email"];

export const POST = route<{ id: string }>(async (c, req, { id }) => {
  const b = await body<{ kind?: LetterKind; tone?: string; instruction?: string }>(req);
  const kind = b.kind ?? "cover_letter";
  if (!KINDS.includes(kind)) throw new HttpError(400, "invalid kind");
  return createLetter(c.db, await c.context(), id, kind, (b.tone ?? "professional").slice(0, 60), b.instruction?.slice(0, 400));
});
