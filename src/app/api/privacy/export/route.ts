import { route } from "@/lib/api";

const TABLES = ["user_profiles", "resumes", "companies", "saved_searches", "jobs", "job_sources", "resume_versions", "cover_letters", "applications", "application_answers", "answer_library", "interviews", "followups", "agent_tasks", "agent_events", "notifications", "bookmarks", "browser_history"];

/** Full JSON export of the user's data (secrets and token hashes excluded). */
export const GET = route(async (c, req) => {
  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), user_id: c.userId };
  for (const t of TABLES) {
    const { data } = await c.db.from(t).select("*").eq("user_id", c.userId);
    out[t] = data ?? [];
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="jobpilot-export-${new Date().toISOString().slice(0, 10)}.json"`, ...(req.headers.get("origin") ? {} : {}) } });
});
