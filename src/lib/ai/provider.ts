// Provider-agnostic AI layer. Server-side only — keys never reach the browser.
import type { z } from "zod";

export interface AIConfig {
  provider: "gemini" | "openai" | "none";
  model: string;
  apiKey: string | null;
}

export interface GenerateOptions {
  system?: string;
  prompt: string;
  temperature?: number;
  json?: boolean;
  /** Gemini only: use Google Search grounding and return cited sources. */
  grounded?: boolean;
  maxOutputTokens?: number;
}

export interface GenerateResult {
  text: string;
  sources: { title: string; url: string }[];
  model: string;
}

export class AIUnavailableError extends Error {
  constructor(msg = "No AI provider configured. Add a Gemini or OpenAI API key in Settings → AI.") {
    super(msg);
    this.name = "AIUnavailableError";
  }
}

export function aiAvailable(cfg: AIConfig | null | undefined): cfg is AIConfig & { apiKey: string } {
  return !!cfg && cfg.provider !== "none" && !!cfg.apiKey;
}

export async function generate(cfg: AIConfig, opts: GenerateOptions): Promise<GenerateResult> {
  if (!aiAvailable(cfg)) throw new AIUnavailableError();
  if (cfg.provider === "gemini") return geminiGenerate(cfg, opts);
  if (cfg.provider === "openai") return openaiGenerate(cfg, opts);
  throw new AIUnavailableError();
}

async function fetchWithRetry(url: string, init: RequestInit, tries = 3): Promise<Response> {
  let last: Response | null = null;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(90_000) });
    if (res.ok) return res;
    last = res;
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
  }
  const body = last ? await last.text().catch(() => "") : "";
  throw new Error(`AI request failed (${last?.status}): ${body.slice(0, 300)}`);
}

async function geminiGenerate(cfg: AIConfig & { apiKey: string }, o: GenerateOptions): Promise<GenerateResult> {
  const model = cfg.model || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: o.prompt }] }],
    generationConfig: {
      temperature: o.temperature ?? 0.3,
      maxOutputTokens: o.maxOutputTokens ?? 8192,
      ...(o.json && !o.grounded ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };
  if (o.grounded) body.tools = [{ google_search: {} }];
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": cfg.apiKey },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    candidates?: {
      content?: { parts?: { text?: string }[] };
      groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
      finishReason?: string;
    }[];
    promptFeedback?: { blockReason?: string };
  };
  const cand = data.candidates?.[0];
  if (!cand) throw new Error(`Gemini returned no candidates${data.promptFeedback?.blockReason ? ` (${data.promptFeedback.blockReason})` : ""}`);
  const text = (cand.content?.parts ?? []).map((p) => p.text ?? "").join("");
  const sources = (cand.groundingMetadata?.groundingChunks ?? [])
    .map((c) => ({ title: c.web?.title ?? "", url: c.web?.uri ?? "" }))
    .filter((s) => s.url);
  return { text, sources, model };
}

async function openaiGenerate(cfg: AIConfig & { apiKey: string }, o: GenerateOptions): Promise<GenerateResult> {
  const model = cfg.model || "gpt-4o-mini";
  const messages = [
    ...(o.system ? [{ role: "system", content: o.system }] : []),
    { role: "user", content: o.prompt },
  ];
  const res = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: o.temperature ?? 0.3,
      max_tokens: o.maxOutputTokens ?? 8192,
      ...(o.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return { text: data.choices?.[0]?.message?.content ?? "", sources: [], model };
}

/** Pull the first JSON object/array out of model text (handles ```json fences). */
export function parseJsonLoose(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[[{]/);
    const endObj = candidate.lastIndexOf("}");
    const endArr = candidate.lastIndexOf("]");
    const end = Math.max(endObj, endArr);
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("AI response was not valid JSON");
  }
}

export async function generateJson<T>(cfg: AIConfig, opts: GenerateOptions, schema: z.ZodType<T>): Promise<{ data: T; sources: GenerateResult["sources"] }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await generate(cfg, { ...opts, json: true, prompt: attempt ? `${opts.prompt}\n\nReturn ONLY valid JSON matching the schema.` : opts.prompt });
    try {
      const parsed = schema.safeParse(parseJsonLoose(r.text));
      if (parsed.success) return { data: parsed.data, sources: r.sources };
      lastErr = new Error(`AI JSON failed validation: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
