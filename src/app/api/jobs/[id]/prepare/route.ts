import { body, route } from "@/lib/api";
import { prepareApplication } from "@/lib/agent/services";

export const POST = route<{ id: string }>(async (c, req, { id }) => {
  const b = await body<{ mode?: "manual" | "assisted" | "auto" }>(req).catch(() => ({ mode: undefined }));
  return prepareApplication(c.db, await c.context(), id, { by: "user", forceMode: b.mode });
});
