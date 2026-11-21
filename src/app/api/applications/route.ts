import { check, route } from "@/lib/api";

export const GET = route(async (c) => {
  const rows = check(
    await c.db
      .from("applications")
      .select("*, jobs(id, title, company, location, remote_type, source, source_url, apply_url, match_score, salary_min, salary_max, currency, salary_period, discovered_at, deadline), interviews(id, scheduled_at, round, interview_type, status), followups(id, due_at, status, type)")
      .eq("user_id", c.userId)
      .order("updated_at", { ascending: false }),
  );
  return { applications: rows };
});
