import { route } from "@/lib/api";
import { daysBetween, everApplied, everResponded, firstAt, median, pct, roleFamily, weekKey, type AppLite } from "@/lib/stats";

export const GET = route(async (c, req) => {
  const u = new URL(req.url);
  const to = u.searchParams.get("to") ?? new Date().toISOString();
  const from = u.searchParams.get("from") ?? new Date(Date.now() - 90 * 864e5).toISOString();
  const [jobsR, appsR, versionsR] = await Promise.all([
    c.db.from("jobs").select("id, title, source, match_score, discovered_at, duplicate_of").eq("user_id", c.userId).gte("discovered_at", from).lte("discovered_at", to),
    c.db.from("applications").select("id, job_id, application_status, applied_at, created_at, updated_at, follow_up_date, resume_version_id, status_history, jobs(title, company, source, match_score)").eq("user_id", c.userId),
    c.db.from("resume_versions").select("id, method, version").eq("user_id", c.userId),
  ]);
  const jobs = (jobsR.data ?? []).filter((j) => !j.duplicate_of);
  const apps = ((appsR.data ?? []) as unknown as AppLite[]).filter((a) => {
    const at = a.applied_at ?? firstAt(a, ["applied"]) ?? a.created_at;
    return at >= from && at <= to;
  });
  const applied = apps.filter(everApplied);
  const responded = applied.filter(everResponded);
  const interviewed = applied.filter((a) => (a.status_history ?? []).some((h) => ["interview", "assessment"].includes(h.to)));
  const offered = applied.filter((a) => (a.status_history ?? []).some((h) => h.to === "offer"));

  const perWeek: Record<string, { week: string; discovered: number; applied: number }> = {};
  for (const j of jobs) {
    const k = weekKey(new Date(j.discovered_at));
    (perWeek[k] ??= { week: k, discovered: 0, applied: 0 }).discovered++;
  }
  for (const a of applied) {
    const k = weekKey(new Date(a.applied_at ?? firstAt(a, ["applied"]) ?? a.created_at));
    (perWeek[k] ??= { week: k, discovered: 0, applied: 0 }).applied++;
  }
  const perMonth: Record<string, number> = {};
  for (const a of applied) {
    const k = (a.applied_at ?? a.created_at).slice(0, 7);
    perMonth[k] = (perMonth[k] ?? 0) + 1;
  }
  const buckets = [0, 50, 65, 80, 90].map((lo, i, arr) => ({ label: i === arr.length - 1 ? `${lo}+` : `${lo}–${arr[i + 1] - 1}`, lo, hi: arr[i + 1] ?? 101, count: 0 }));
  for (const j of jobs) if (j.match_score != null) buckets.find((b) => j.match_score! >= b.lo && j.match_score! < b.hi)!.count++;

  const group = <K extends string>(keyOf: (a: AppLite) => K, jobKey?: (j: { source: string; title: string }) => K) => {
    const m: Record<string, { key: string; jobs: number; applied: number; responses: number; interviews: number }> = {};
    if (jobKey) for (const j of jobs) (m[jobKey(j)] ??= { key: jobKey(j), jobs: 0, applied: 0, responses: 0, interviews: 0 }).jobs++;
    for (const a of applied) {
      const k = keyOf(a);
      const g = (m[k] ??= { key: k, jobs: 0, applied: 0, responses: 0, interviews: 0 });
      g.applied++;
      if (everResponded(a)) g.responses++;
      if (interviewed.includes(a)) g.interviews++;
    }
    return Object.values(m).map((g) => ({ ...g, response_rate: pct(g.responses, g.applied) })).sort((a, b) => b.applied - a.applied || b.jobs - a.jobs);
  };
  const versions = new Map((versionsR.data ?? []).map((v) => [v.id, v]));
  const timeToResponse = responded.map((a) => {
    const ap = a.applied_at ?? firstAt(a, ["applied"]);
    const rs = firstAt(a, ["recruiter_contacted", "assessment", "interview", "offer", "rejected"]);
    return ap && rs ? daysBetween(ap, rs) : null;
  }).filter((x): x is number => x != null);
  const timeToInterview = interviewed.map((a) => {
    const ap = a.applied_at ?? firstAt(a, ["applied"]);
    const iv = firstAt(a, ["interview", "assessment"]);
    return ap && iv ? daysBetween(ap, iv) : null;
  }).filter((x): x is number => x != null);
  const companies: Record<string, number> = {};
  for (const a of applied) if (a.jobs) companies[a.jobs.company] = (companies[a.jobs.company] ?? 0) + 1;

  return {
    range: { from, to },
    totals: {
      discovered: jobs.length,
      applied: applied.length,
      responses: responded.length,
      interviews: interviewed.length,
      offers: offered.length,
      response_rate: pct(responded.length, applied.length),
      interview_rate: pct(interviewed.length, applied.length),
      offer_rate: pct(offered.length, applied.length),
      median_days_to_response: median(timeToResponse),
      median_days_to_interview: median(timeToInterview),
    },
    per_week: Object.values(perWeek).sort((a, b) => a.week.localeCompare(b.week)),
    per_month: Object.entries(perMonth).sort().map(([month, applied]) => ({ month, applied })),
    score_distribution: buckets.map(({ label, count }) => ({ label, count })),
    by_source: group((a) => a.jobs?.source ?? "unknown", (j) => j.source),
    by_role: group((a) => roleFamily(a.jobs?.title ?? ""), (j) => roleFamily(j.title)),
    by_resume: group((a) => {
      const v = a.resume_version_id ? versions.get(a.resume_version_id) : null;
      return v ? (v.method === "ai" ? "AI-tailored" : "Rule-tailored") : "No tailored resume";
    }),
    companies: Object.entries(companies).map(([company, count]) => ({ company, count })).sort((a, b) => b.count - a.count),
  };
});
