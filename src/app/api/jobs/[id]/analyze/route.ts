import { route } from "@/lib/api";
import { analyzeJob } from "@/lib/agent/services";

export const POST = route<{ id: string }>(async (c, _req, { id }) => analyzeJob(c.db, await c.context(), id));
