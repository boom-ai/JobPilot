// Activity feed + notifications. Every entry is written by a real operation.
import type { DB } from "../supabase/clients";
import type { AppSettings } from "../types";

export async function logEvent(db: DB, userId: string, kind: string, message: string, data: Record<string, unknown> = {}, taskId?: string | null) {
  await db.from("agent_events").insert({ user_id: userId, kind, message, data, task_id: taskId ?? null });
}

export type NotificationType =
  | "high_match" | "saved_search" | "application" | "failure" | "recruiter" | "interview" | "assessment" | "offer" | "followup" | "resume" | "agent_error";

const PREF_KEY: Record<NotificationType, string> = {
  high_match: "high_match", saved_search: "saved_search", application: "application", failure: "failure", recruiter: "recruiter",
  interview: "interview", assessment: "interview", offer: "application", followup: "followup", resume: "resume", agent_error: "agent_error",
};

export async function notify(
  db: DB,
  userId: string,
  settings: AppSettings,
  n: { type: NotificationType; title: string; content?: string; link?: string },
  external?: { telegramToken?: string | null },
) {
  if (settings.notifications.in_app[PREF_KEY[n.type]] === false) return;
  await db.from("notifications").insert({ user_id: userId, type: n.type, title: n.title, content: n.content ?? null, link: n.link ?? null });
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const text = `${n.title}${n.content ? `\n${n.content}` : ""}${n.link && base ? `\n${base}${n.link}` : ""}`;
  // Optional external channels — failures here never break the agent.
  try {
    if (external?.telegramToken && settings.notifications.telegram_chat_id) {
      await fetch(`https://api.telegram.org/bot${external.telegramToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: settings.notifications.telegram_chat_id, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
    }
    if (settings.notifications.discord_webhook_url) {
      await fetch(settings.notifications.discord_webhook_url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text.slice(0, 1900) }),
        signal: AbortSignal.timeout(10_000),
      });
    }
  } catch {
    /* external notification failure is non-fatal */
  }
}
