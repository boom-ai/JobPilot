"use client";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "@/lib/client";
import { Empty, ErrorNote, Field, Input, Loading, PageHeader, Panel, Segmented, Stat } from "@/components/ui";
import { sourceLabel } from "@/components/jobs";

interface Group {
  key: string;
  jobs: number;
  applied: number;
  responses: number;
  interviews: number;
  response_rate: number | null;
}
interface A {
  range: { from: string; to: string };
  totals: Record<string, number | null>;
  per_week: { week: string; discovered: number; applied: number }[];
  per_month: { month: string; applied: number }[];
  score_distribution: { label: string; count: number }[];
  by_source: Group[];
  by_role: Group[];
  by_resume: Group[];
  companies: { company: string; count: number }[];
}

const axis = { stroke: "var(--fg-faint)", fontSize: 11 };
const tip = { contentStyle: { background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }, labelStyle: { color: "var(--fg)" } };

export default function AnalyticsPage() {
  const [preset, setPreset] = useState<"30" | "90" | "365" | "custom">("90");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [now] = useState(() => Date.now());
  const range = preset === "custom" && from ? `from=${new Date(from).toISOString()}&to=${new Date(to || now).toISOString()}` : `from=${new Date(now - Number(preset === "custom" ? 90 : preset) * 864e5).toISOString()}`;
  const { data, error, loading, reload } = useApi<A>(`/api/analytics?${range}`);
  const pct = (v: number | null | undefined) => (v == null ? "—" : `${v}%`);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Analytics"
        subtitle="Computed only from your actual records."
        actions={
          <div className="flex items-end gap-2">
            <Segmented value={preset} onChange={setPreset} items={[{ value: "30", label: "30d" }, { value: "90", label: "90d" }, { value: "365", label: "1y" }, { value: "custom", label: "Custom" }]} />
            {preset === "custom" && (
              <>
                <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-7" /></Field>
                <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-7" /></Field>
              </>
            )}
          </div>
        }
      />
      {loading && !data ? <Loading /> : error ? <ErrorNote error={error} onRetry={reload} /> : data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <Stat label="Jobs discovered" value={data.totals.discovered ?? 0} />
            <Stat label="Applied" value={data.totals.applied ?? 0} />
            <Stat label="Responses" value={data.totals.responses ?? 0} />
            <Stat label="Response rate" value={pct(data.totals.response_rate)} />
            <Stat label="Interview rate" value={pct(data.totals.interview_rate)} />
            <Stat label="Offer rate" value={pct(data.totals.offer_rate)} />
            <Stat label="Median days → response" value={data.totals.median_days_to_response ?? "—"} />
            <Stat label="Median days → interview" value={data.totals.median_days_to_interview ?? "—"} />
          </div>
          {!data.totals.discovered && !data.totals.applied ? (
            <Empty title="No data in this range yet">Charts appear as jobs are discovered and applications are tracked.</Empty>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Jobs discovered vs applications per week">
                <div className="h-64">
                  <ResponsiveContainer>
                    <LineChart data={data.per_week}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="week" tick={axis} tickFormatter={(w: string) => w.slice(5)} />
                      <YAxis tick={axis} allowDecimals={false} />
                      <Tooltip {...tip} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="discovered" name="Discovered" stroke="var(--fg-faint)" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="applied" name="Applied" stroke="var(--accent)" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
              <Panel title="Match score distribution">
                <div className="h-64">
                  <ResponsiveContainer>
                    <BarChart data={data.score_distribution}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="label" tick={axis} />
                      <YAxis tick={axis} allowDecimals={false} />
                      <Tooltip {...tip} cursor={{ fill: "var(--bg-subtle)" }} />
                      <Bar dataKey="count" name="Jobs" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
              <Panel title="Applications per month">
                <div className="h-56">
                  <ResponsiveContainer>
                    <BarChart data={data.per_month}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="month" tick={axis} />
                      <YAxis tick={axis} allowDecimals={false} />
                      <Tooltip {...tip} cursor={{ fill: "var(--bg-subtle)" }} />
                      <Bar dataKey="applied" name="Applied" fill="var(--info)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
              <GroupTable title="Source performance" rows={data.by_source} fmt={sourceLabel} />
              <GroupTable title="Role performance" rows={data.by_role} />
              <GroupTable title="Resume version performance" rows={data.by_resume} hideJobs />
              <Panel title="Companies applied to" bodyClass="p-0">
                {data.companies.length ? (
                  <ul className="divide-y divide-line text-[13px]">{data.companies.slice(0, 20).map((c) => <li key={c.company} className="flex justify-between px-3.5 py-1.5"><span>{c.company}</span><span className="tabular-nums text-muted">{c.count}</span></li>)}</ul>
                ) : (
                  <p className="p-3.5 text-muted">No applications yet.</p>
                )}
              </Panel>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GroupTable({ title, rows, fmt, hideJobs }: { title: string; rows: Group[]; fmt?: (k: string) => string; hideJobs?: boolean }) {
  return (
    <Panel title={title} bodyClass="p-0">
      <table className="w-full text-[12.5px]">
        <thead className="border-b border-line text-left text-muted">
          <tr>
            <th className="px-3.5 py-1.5 font-medium">Group</th>
            {!hideJobs && <th className="px-2 py-1.5 text-right font-medium">Jobs</th>}
            <th className="px-2 py-1.5 text-right font-medium">Applied</th>
            <th className="px-2 py-1.5 text-right font-medium">Responses</th>
            <th className="px-2 py-1.5 text-right font-medium">Interviews</th>
            <th className="px-3.5 py-1.5 text-right font-medium">Resp. rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.length ? rows.map((r) => (
            <tr key={r.key}>
              <td className="px-3.5 py-1.5">{fmt ? fmt(r.key) : r.key}</td>
              {!hideJobs && <td className="px-2 py-1.5 text-right tabular-nums">{r.jobs}</td>}
              <td className="px-2 py-1.5 text-right tabular-nums">{r.applied}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.responses}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.interviews}</td>
              <td className="px-3.5 py-1.5 text-right tabular-nums">{r.response_rate == null ? "—" : `${r.response_rate}%`}</td>
            </tr>
          )) : <tr><td colSpan={6} className="px-3.5 py-3 text-muted">No data.</td></tr>}
        </tbody>
      </table>
    </Panel>
  );
}
