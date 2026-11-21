import { check, route } from "@/lib/api";

export const GET = route(async (c) => ({
  versions: check(await c.db.from("resume_versions").select("id, job_id, version, file_name, method, created_at, updated_at, jobs(title, company)").eq("user_id", c.userId).order("created_at", { ascending: false }).limit(200)),
}));
