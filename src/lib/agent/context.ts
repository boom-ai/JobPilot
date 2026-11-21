// Load everything the agent needs for one user.
import type { DB } from "../supabase/clients";
import type { AppSettings, CareerProfile, JobPreferences } from "../types";
import { mergePreferences, mergeSettings } from "../defaults";
import { emptyProfile } from "../resume/parse";
import { decryptSecret } from "../crypto";
import type { AIConfig } from "../ai/provider";

export interface UserContext {
  userId: string;
  profile: CareerProfile;
  preferences: JobPreferences;
  settings: AppSettings;
  ai: AIConfig;
  hasProfile: boolean;
}

/**
 * `secretsDb` must be a client allowed to read user_secrets (the service-role client);
 * RLS deliberately prevents browsers from selecting that table.
 */
export async function loadUserContext(db: DB, userId: string, secretsDb?: DB | null): Promise<UserContext> {
  const { data: row, error } = await db.from("user_profiles").select("profile_data, preferences, settings").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`Could not load profile: ${error.message}`);
  const settings = mergeSettings(row?.settings as Partial<AppSettings>);
  const preferences = mergePreferences(row?.preferences as Partial<JobPreferences>);
  const stored = row?.profile_data as CareerProfile | undefined;
  const profile = stored && stored.name !== undefined ? { ...emptyProfile(), ...stored } : emptyProfile();
  let key: string | null = null;
  if (secretsDb) {
    const { data: sec } = await secretsDb.from("user_secrets").select("ai_api_key_enc").eq("user_id", userId).maybeSingle();
    try {
      key = decryptSecret(sec?.ai_api_key_enc ?? null);
    } catch {
      key = null;
    }
  }
  if (!key) key = settings.ai.provider === "openai" ? process.env.OPENAI_API_KEY ?? null : process.env.GEMINI_API_KEY ?? null;
  return {
    userId,
    profile,
    preferences,
    settings,
    ai: { provider: key ? settings.ai.provider : "none", model: settings.ai.model, apiKey: key },
    hasProfile: !!(profile.name || profile.experience.length),
  };
}
