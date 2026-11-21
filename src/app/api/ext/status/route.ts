import { body, HttpError, preflight, route } from "@/lib/api";
import { setApplicationStatus } from "@/lib/agent/records";
import { logEvent } from "@/lib/agent/events";

export const OPTIONS = preflight;

/**
 * Sync status from the extension. "applied" is only accepted with evidence: either the user clicked
 * "I submitted this" (evidence.kind = "user_confirmed") or a confirmation page was detected.
 */
export const POST = route(async (c, req) => {
  const b = await body<{ job_id: string; status: "applied" | "application_confirmed"; evidence: { kind: "user_confirmed" | "confirmation_page"; url?: string; text?: string } }>(req);
  if (!b.job_id || !["applied", "application_confirmed"].includes(b.status)) throw new HttpError(400, "job_id and status required");
  if (!b.evidence?.kind) throw new HttpError(400, "evidence required — the app never records a submission without it");
  const r = await setApplicationStatus(c.db, c.userId, b.job_id, b.status, { by: "user", note: b.evidence.kind === "user_confirmed" ? "Confirmed by you in the extension" : `Confirmation page detected: ${b.evidence.url ?? ""}`, extra: { submission_evidence: { ...b.evidence, at: new Date().toISOString(), via: "extension" }, mode: "assisted" } });
  await logEvent(c.db, c.userId, "application_submitted", `Application recorded via extension (${b.evidence.kind.replace("_", " ")})`, { job_id: b.job_id });
  return r;
});
