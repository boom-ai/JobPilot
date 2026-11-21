import { body, check, route } from "@/lib/api";
import { mergePreferences, mergeSettings } from "@/lib/defaults";
import type { AppSettings, CareerProfile, JobPreferences } from "@/lib/types";
import { experienceYears } from "@/lib/resume/parse";

export const GET = route(async (c) => {
  const ctx = await c.context();
  return { profile: ctx.profile, preferences: ctx.preferences, settings: ctx.settings, experience_years: experienceYears(ctx.profile.experience) };
});

/** Partial update: any of profile / preferences / settings. Settings are deep-merged with defaults. */
export const PUT = route(async (c, req) => {
  const b = await body<{ profile?: CareerProfile; preferences?: Partial<JobPreferences>; settings?: Partial<AppSettings> }>(req);
  const ctx = await c.context();
  const patch: Record<string, unknown> = {};
  if (b.profile) patch.profile_data = { ...b.profile, unknown_fields: (b.profile.unknown_fields ?? []).filter((f) => !isFilled(b.profile!, f)) };
  if (b.preferences) patch.preferences = mergePreferences({ ...ctx.preferences, ...b.preferences });
  if (b.settings) {
    const s = mergeSettings({ ...ctx.settings, ...b.settings } as Partial<AppSettings>);
    // clamp numbers to sane ranges
    s.automation.daily_limit = Math.max(0, Math.min(100, Number(s.automation.daily_limit) || 0));
    s.automation.weekly_limit = Math.max(0, Math.min(500, Number(s.automation.weekly_limit) || 0));
    patch.settings = s;
  }
  check(await c.db.from("user_profiles").update(patch).eq("user_id", c.userId));
  return { ok: true };
});

function isFilled(p: CareerProfile, field: string): boolean {
  const f = field.toLowerCase();
  if (f === "name") return !!p.name;
  if (f === "email") return !!p.email;
  if (f === "phone") return !!p.phone;
  if (f === "location") return !!p.location;
  if (f === "summary") return !!p.summary;
  if (f.includes("linkedin")) return p.links.some((l) => /linkedin/i.test(l.url));
  if (f.includes("github")) return p.links.some((l) => /github/i.test(l.url));
  return false;
}
