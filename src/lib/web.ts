// Safe server-side fetching of user-supplied URLs (reader view, job capture).
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { htmlToText, decodeEntities } from "./text";
import type { NormalizedJob } from "./types";

function privateIp(ip: string): boolean {
  if (ip.includes(":")) return ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80");
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only http(s) URLs are allowed");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) throw new Error("Private addresses are not allowed");
  const ips = isIP(u.hostname) ? [u.hostname] : (await lookup(u.hostname, { all: true })).map((r) => r.address);
  if (ips.some(privateIp)) throw new Error("Private addresses are not allowed");
  return u;
}

export interface InspectResult {
  url: string;
  final_url: string;
  status: number;
  title: string;
  embeddable: boolean;
  embed_block_reason: string | null;
  text: string;
  job: Partial<NormalizedJob> | null;
}

/** Fetch a page: can it be iframed? what is its readable text? does it contain a JobPosting? */
export async function inspectUrl(raw: string): Promise<InspectResult> {
  const u = await assertPublicUrl(raw);
  const res = await fetch(u, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (JobPilotAI reader)", accept: "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(15_000) });
  const xfo = res.headers.get("x-frame-options");
  const csp = res.headers.get("content-security-policy") ?? "";
  const fa = /frame-ancestors\s+([^;]+)/i.exec(csp)?.[1]?.trim() ?? null;
  let reason: string | null = null;
  if (xfo && /deny|sameorigin/i.test(xfo)) reason = `X-Frame-Options: ${xfo}`;
  else if (fa && !/\*/.test(fa)) reason = `CSP frame-ancestors: ${fa}`;
  const html = (await res.text()).slice(0, 2_000_000);
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? u.hostname);
  const main = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<body[\s\S]*?<\/body>/i.exec(html)?.[0] ?? html;
  return { url: raw, final_url: res.url, status: res.status, title, embeddable: !reason && res.ok, embed_block_reason: reason, text: htmlToText(main.replace(/<(nav|footer|header)[\s\S]*?<\/\1>/gi, "")).slice(0, 40000), job: extractJobPosting(html, res.url) };
}

/** Parse schema.org JobPosting JSON-LD — present on most ATS and many job boards. */
export function extractJobPosting(html: string, url: string): Partial<NormalizedJob> | null {
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const items = (Array.isArray(data) ? data : [data]).flatMap((d) => ((d as { "@graph"?: unknown[] })["@graph"] ? (d as { "@graph": unknown[] })["@graph"] : [d])) as Record<string, unknown>[];
    const jp = items.find((i) => i["@type"] === "JobPosting" || (Array.isArray(i["@type"]) && (i["@type"] as string[]).includes("JobPosting")));
    if (!jp) continue;
    const org = jp.hiringOrganization as { name?: string; logo?: string } | undefined;
    const locs = (Array.isArray(jp.jobLocation) ? jp.jobLocation : jp.jobLocation ? [jp.jobLocation] : []) as { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string | { name?: string } } }[];
    const location = locs.map((l) => [l.address?.addressLocality, l.address?.addressRegion, typeof l.address?.addressCountry === "object" ? l.address?.addressCountry?.name : l.address?.addressCountry].filter(Boolean).join(", ")).filter(Boolean).join(" / ");
    const sal = jp.baseSalary as { currency?: string; value?: { minValue?: number; maxValue?: number; value?: number; unitText?: string } } | undefined;
    const unit = sal?.value?.unitText?.toUpperCase();
    return {
      title: String(jp.title ?? ""),
      company: org?.name ?? "",
      company_logo: typeof org?.logo === "string" ? org.logo : null,
      description: htmlToText(String(jp.description ?? "")),
      location: location || null,
      remote_type: jp.jobLocationType === "TELECOMMUTE" ? "remote" : undefined,
      posted_at: jp.datePosted ? new Date(String(jp.datePosted)).toISOString() : null,
      deadline: jp.validThrough ? String(jp.validThrough).slice(0, 10) : null,
      salary_min: sal?.value?.minValue ?? sal?.value?.value ?? null,
      salary_max: sal?.value?.maxValue ?? sal?.value?.value ?? null,
      currency: sal?.currency ?? null,
      salary_period: unit === "HOUR" ? "hour" : unit === "MONTH" ? "month" : sal ? "year" : null,
      source_url: url,
      apply_url: url,
      external_job_id: typeof jp.identifier === "object" ? String((jp.identifier as { value?: string }).value ?? "") || null : null,
    };
  }
  return null;
}
