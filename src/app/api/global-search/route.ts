import { route } from "@/lib/api";

/** Global search across jobs, companies and application records. */
export const GET = route(async (c, req) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().replace(/[%,()]/g, " ");
  if (q.length < 2) return { jobs: [], companies: [], applications: [] };
  const like = `%${q}%`;
  const [jobs, companies, apps] = await Promise.all([
    c.db.from("jobs").select("id, title, company, location, match_score, source").eq("user_id", c.userId).is("duplicate_of", null).or(`title.ilike.${like},company.ilike.${like},location.ilike.${like}`).order("match_score", { ascending: false }).limit(8),
    c.db.from("companies").select("id, name, industry").eq("user_id", c.userId).ilike("name", like).limit(5),
    c.db.from("applications").select("id, job_id, application_status, notes, jobs!inner(title, company)").eq("user_id", c.userId).limit(400),
  ]);
  const ql = q.toLowerCase();
  const matchedApps = ((apps.data ?? []) as unknown as { id: string; job_id: string; application_status: string; notes: string | null; jobs: { title: string; company: string } }[])
    .filter((a) => `${a.jobs.title} ${a.jobs.company} ${a.notes ?? ""}`.toLowerCase().includes(ql))
    .slice(0, 8);
  return { jobs: jobs.data ?? [], companies: companies.data ?? [], applications: matchedApps };
});
