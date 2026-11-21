import { route } from "@/lib/api";
import { createTailoredResume } from "@/lib/agent/services";

export const POST = route<{ id: string }>(async (c, _req, { id }) => {
  const r = await createTailoredResume(c.db, await c.context(), id);
  return { id: r.id, version: r.version, file_name: r.file_name, method: r.method, rejected: r.issues };
});
