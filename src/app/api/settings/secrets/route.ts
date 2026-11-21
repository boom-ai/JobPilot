import { body, HttpError, route } from "@/lib/api";
import { decryptSecret, encryptSecret, maskKey } from "@/lib/crypto";

export const GET = route(async (c) => {
  if (!c.secretsDb) return { storage: false, ai_api_key: null, telegram_bot_token: null };
  const { data } = await c.secretsDb.from("user_secrets").select("ai_api_key_enc, telegram_bot_token_enc").eq("user_id", c.userId).maybeSingle();
  const safe = (v?: string | null) => {
    try {
      return maskKey(decryptSecret(v ?? null));
    } catch {
      return "unreadable — re-enter";
    }
  };
  return { storage: true, ai_api_key: safe(data?.ai_api_key_enc), telegram_bot_token: safe(data?.telegram_bot_token_enc), env_fallback: { gemini: !!process.env.GEMINI_API_KEY, openai: !!process.env.OPENAI_API_KEY } };
});

/** Store secrets encrypted (AES-256-GCM). Values are never returned in plaintext. */
export const PUT = route(async (c, req) => {
  if (!c.secretsDb) throw new HttpError(400, "Server is missing SUPABASE_SERVICE_ROLE_KEY; set keys via environment variables instead.");
  const b = await body<{ ai_api_key?: string | null; telegram_bot_token?: string | null }>(req);
  const row: Record<string, unknown> = { user_id: c.userId, updated_at: new Date().toISOString() };
  if (b.ai_api_key !== undefined) row.ai_api_key_enc = b.ai_api_key ? encryptSecret(b.ai_api_key.trim()) : null;
  if (b.telegram_bot_token !== undefined) row.telegram_bot_token_enc = b.telegram_bot_token ? encryptSecret(b.telegram_bot_token.trim()) : null;
  const { error } = await c.secretsDb.from("user_secrets").upsert(row, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
  return { ok: true };
});
