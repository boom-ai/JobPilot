import { route } from "@/lib/api";
import { ALL_SOURCES } from "@/lib/sources/adapters";
import { queryFromSearch } from "@/lib/agent/pipeline";

/** Source catalogue with honest status, last result per source, and manual search links. */
export const GET = route(async (c, req) => {
  const ctx = await c.context();
  const u = new URL(req.url);
  const kw = u.searchParams.get("q");
  const q = queryFromSearch(ctx, kw ? { query: { keywords: kw } } : null);
  const { data: lastSearch } = await c.db.from("agent_tasks").select("result, finished_at").eq("user_id", c.userId).eq("task_type", "search").eq("status", "completed").order("finished_at", { ascending: false }).limit(1);
  const last = ((lastSearch?.[0]?.result as { sources?: { source: string; ok: boolean; count: number; error?: string; skipped?: string }[] })?.sources ?? []);
  return {
    sources: ALL_SOURCES.map((s) => {
      const lr = last.find((l) => l.source === s.id);
      let status: string = s.status(ctx.settings);
      if (status === "available" && lr) status = lr.ok ? "connected" : lr.skipped ? status : "api_unavailable";
      return {
        id: s.id,
        name: s.name,
        kind: s.kind,
        homepage: s.homepage,
        notes: s.notes,
        status,
        last_result: lr ?? null,
        last_checked: lastSearch?.[0]?.finished_at ?? null,
        search_url: s.searchUrl ? s.searchUrl(q) : null,
      };
    }),
  };
});
