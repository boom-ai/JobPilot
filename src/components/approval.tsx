"use client";
import { post } from "@/lib/client";
import { Button, useAction } from "./ui";

export function ApprovalBox({ app, reload }: { app: { id: string; review_data: Record<string, unknown> | null }; reload: () => void }) {
  const review = app.review_data as { filled?: { label: string; value: string }[]; missing?: string[]; declarations?: string[]; screenshot?: string; url?: string; ats?: string } | null;
  const { busy, run } = useAction();
  return (
    <div className="rounded-md border border-warn/40 bg-warn-soft p-3 text-[13px]">
      <p className="font-medium text-warn">Awaiting your approval before submission</p>
      {review?.filled?.length ? (
        <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-3 gap-y-1 text-[12.5px]">
          {review.filled.map((f) => (
            <div key={f.label} className="contents">
              <dt className="truncate text-muted">{f.label}</dt>
              <dd className="truncate">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-1 text-[12.5px] text-muted">Review the prepared resume, letter and answers above.</p>
      )}
      {review?.missing?.length ? <p className="mt-2 text-bad">Missing required fields: {review.missing.join(", ")}</p> : null}
      {review?.declarations?.length ? <p className="mt-2 text-warn">Legal declarations on the form: {review.declarations.join("; ")} — approving with declarations means you accept them.</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" loading={busy === "ok"} disabled={!!review?.missing?.length} onClick={() => run("ok", () => post(`/api/applications/${app.id}`, { action: "approve" }), "Approved — the browser worker will submit").then(reload)}>Approve & submit</Button>
        {review?.declarations?.length ? <Button size="sm" loading={busy === "okd"} onClick={() => run("okd", () => post(`/api/applications/${app.id}`, { action: "approve_declarations" }), "Approved incl. declarations").then(reload)}>Approve incl. declarations</Button> : null}
        <Button size="sm" variant="ghost" onClick={() => run("no", () => post(`/api/applications/${app.id}`, { action: "reject" }), "Cancelled").then(reload)}>Cancel submission</Button>
      </div>
    </div>
  );
}
