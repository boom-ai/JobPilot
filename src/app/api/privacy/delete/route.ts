import { body, HttpError, route } from "@/lib/api";

const SCOPES: Record<string, string[]> = {
  resumes: ["resume_versions", "resumes"],
  applications: ["application_answers", "followups", "interviews", "applications", "cover_letters"],
  jobs: ["job_sources", "jobs", "companies"],
  activity: ["agent_events", "agent_tasks", "notifications", "browser_history"],
  profile: [],
  all: ["application_answers", "followups", "interviews", "applications", "cover_letters", "resume_versions", "resumes", "job_sources", "jobs", "companies", "saved_searches", "answer_library", "agent_events", "agent_tasks", "notifications", "bookmarks", "browser_history", "api_tokens", "agent_state", "user_profiles"],
};

/** Delete personal data by scope. Requires {confirm: "DELETE"}. */
export const POST = route(async (c, req) => {
  const b = await body<{ scope: string; confirm: string }>(req);
  if (b.confirm !== "DELETE") throw new HttpError(400, 'Type DELETE to confirm');
  const tables = SCOPES[b.scope];
  if (!tables) throw new HttpError(400, "unknown scope");
  if (b.scope === "resumes" || b.scope === "all") {
    const { data } = await c.db.from("resumes").select("original_file_path").eq("user_id", c.userId);
    const paths = (data ?? []).map((r) => r.original_file_path).filter(Boolean) as string[];
    if (paths.length) await c.db.storage.from("resumes").remove(paths);
  }
  for (const t of tables) {
    const { error } = await c.db.from(t).delete().eq("user_id", c.userId);
    if (error) throw new Error(`${t}: ${error.message}`);
  }
  if (b.scope === "profile") await c.db.from("user_profiles").update({ profile_data: {} }).eq("user_id", c.userId);
  if (b.scope === "all" && c.secretsDb) await c.secretsDb.from("user_secrets").delete().eq("user_id", c.userId);
  return { ok: true, scope: b.scope };
});
