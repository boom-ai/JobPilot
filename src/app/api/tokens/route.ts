import { body, check, HttpError, route } from "@/lib/api";
import { newApiToken } from "@/lib/crypto";

export const GET = route(async (c) => ({ tokens: check(await c.db.from("api_tokens").select("id, name, token_prefix, last_used_at, created_at").eq("user_id", c.userId).order("created_at")) }));

/** Create a personal access token for the Chrome extension. The plaintext is returned once. */
export const POST = route(async (c, req) => {
  const b = await body<{ name?: string }>(req);
  const t = newApiToken();
  check(await c.db.from("api_tokens").insert({ user_id: c.userId, name: (b.name || "Chrome extension").slice(0, 60), token_hash: t.hash, token_prefix: t.prefix }));
  return { token: t.token };
});

export const DELETE = route(async (c, req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "id required");
  check(await c.db.from("api_tokens").delete().eq("id", id).eq("user_id", c.userId));
  return { ok: true };
});
