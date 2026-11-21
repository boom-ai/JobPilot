import { check, HttpError, route } from "@/lib/api";
import { extractResumeFile, meaningfulLinks } from "@/lib/resume/extract";
import { parseResumeText } from "@/lib/resume/parse";
import { extractProfileAI } from "@/lib/ai/tasks";
import { aiAvailable } from "@/lib/ai/provider";
import { logEvent } from "@/lib/agent/events";
import type { CareerProfile } from "@/lib/types";

export const GET = route(async (c) => {
  const data = check(await c.db.from("resumes").select("id, filename, mime_type, extraction_method, resume_type, is_primary, created_at, extracted_data").eq("user_id", c.userId).order("created_at", { ascending: false }));
  return { resumes: data };
});

const MAX = 8 * 1024 * 1024;

/** Upload a PDF/DOCX resume → extract text → structured profile (AI when configured, verified against the text). */
export const POST = route(async (c, req) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Attach a file field named 'file'.");
  if (file.size > MAX) throw new HttpError(413, "File too large (max 8 MB).");
  const applyToProfile = form.get("apply_to_profile") !== "false";
  const buf = new Uint8Array(await file.arrayBuffer());
  const extracted = await extractResumeFile(buf, file.name, file.type);
  const heuristic = parseResumeText(extracted.text);
  const links = meaningfulLinks(extracted.links);
  if (links.length) {
    heuristic.links = links;
    heuristic.unknown_fields = (heuristic.unknown_fields ?? []).filter((f) => !links.some((l) => f.toLowerCase().startsWith(l.label.toLowerCase())));
  }
  const ctx = await c.context();
  let profile: CareerProfile = heuristic;
  let method = "heuristic";
  let dropped: string[] = [];
  let aiError: string | null = null;
  if (aiAvailable(ctx.ai)) {
    try {
      const r = await extractProfileAI(ctx.ai, extracted.text, heuristic);
      profile = { ...r.profile, links: links.length ? links : r.profile.links };
      dropped = r.dropped;
      method = "ai";
    } catch (e) {
      aiError = (e as Error).message;
    }
  }
  const path = `${c.userId}/${Date.now()}_${file.name.replace(/[^\w.-]+/g, "_")}`;
  let storedPath: string | null = null;
  const up = await c.db.storage.from("resumes").upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: false });
  if (!up.error) storedPath = path;
  const { count } = await c.db.from("resumes").select("id", { count: "exact", head: true }).eq("user_id", c.userId);
  const isPrimary = !count || applyToProfile;
  if (isPrimary) await c.db.from("resumes").update({ is_primary: false }).eq("user_id", c.userId);
  const row = check(
    await c.db
      .from("resumes")
      .insert({ user_id: c.userId, filename: file.name, original_file_path: storedPath, mime_type: file.type, raw_text: extracted.text, extracted_data: profile, extraction_method: method, is_primary: isPrimary })
      .select("id, filename, extraction_method, is_primary, created_at")
      .single(),
  );
  if (applyToProfile) check(await c.db.from("user_profiles").update({ profile_data: profile }).eq("user_id", c.userId));
  await logEvent(c.db, c.userId, "resume_uploaded", `Parsed ${file.name} (${method}); ${profile.experience.length} roles, ${profile.skills.flatMap((g) => g.items).length} skills`, { dropped });
  return { resume: row, profile, method, dropped, ai_error: aiError, storage_error: up.error?.message ?? null, unknown_fields: profile.unknown_fields ?? [] };
});
