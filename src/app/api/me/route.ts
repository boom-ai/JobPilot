import { route } from "@/lib/api";
import { isLocalMode } from "@/lib/supabase/clients";
import { aiAvailable } from "@/lib/ai/provider";
import { agentState } from "@/lib/agent/queue";

export const GET = route(async (c) => {
  const ctx = await c.context();
  const { count: unread } = await c.db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", c.userId).eq("read", false);
  const { count: awaiting } = await c.db.from("applications").select("id", { count: "exact", head: true }).eq("user_id", c.userId).eq("application_status", "awaiting_approval");
  return {
    user: { id: c.userId, email: c.email },
    local_mode: isLocalMode(),
    app_name: ctx.settings.app_name,
    ai: { configured: aiAvailable(ctx.ai), provider: ctx.ai.provider, model: ctx.ai.model },
    has_profile: ctx.hasProfile,
    profile_name: ctx.profile.name,
    agent_state: await agentState(c.db, c.userId),
    unread_notifications: unread ?? 0,
    awaiting_approval: awaiting ?? 0,
    secrets_storage: !!c.secretsDb,
  };
});
