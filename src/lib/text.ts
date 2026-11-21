// Text utilities shared by parsing, matching, dedupe and adapters.

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&rsquo;": "'",
  "&lsquo;": "'",
  "&ldquo;": '"',
  "&rdquo;": '"',
  "&ndash;": "–",
  "&mdash;": "—",
  "&bull;": "•",
  "&hellip;": "…",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

/** Convert HTML (possibly entity-escaped, as Greenhouse returns) into readable plain text. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  let s = html;
  if (/&lt;[a-z/]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|section)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalize(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9+#.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COMPANY_SUFFIXES = /\b(inc|llc|ltd|limited|pvt|private|corp|corporation|co|gmbh|plc|technologies|technology|labs|group|holdings)\b\.?/g;
export function normalizeCompany(s: string | null | undefined): string {
  return normalize(s).replace(/\./g, " ").replace(COMPANY_SUFFIXES, "").replace(/\s+/g, " ").trim();
}

export const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can for from has have in into is it its of on or our that the their " +
    "this to was we will with you your they them who what when where which while within without would should " +
    "could may must not no yes all any each more most other some such than too very just also about above after " +
    "again against am being below between both did do does doing down during few further here how i if me my " +
    "myself nor off once only out over own same so then there these those through under until up us job role " +
    "work team company position candidate candidates experience years year ability strong excellent good using " +
    "including etc e.g ie per new across well help make ensure join looking seeking opportunity"
  ).split(" "),
);

export function tokenize(s: string | null | undefined): string[] {
  return normalize(s)
    .split(" ")
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function shingles(text: string, k = 4): Set<string> {
  const toks = tokenize(text);
  const out = new Set<string>();
  for (let i = 0; i + k <= toks.length; i++) out.add(toks.slice(i, i + k).join(" "));
  if (!out.size && toks.length) out.add(toks.join(" "));
  return out;
}

export function uid(prefix = ""): string {
  return prefix + Math.random().toString(36).slice(2, 10);
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word / phrase containment that tolerates symbols like C++ or Node.js. */
export function containsTerm(haystackNorm: string, term: string): boolean {
  const t = normalize(term);
  if (!t) return false;
  const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(t)}($|[^a-z0-9+#])`);
  return re.test(haystackNorm);
}

// ---------------------------------------------------------------------------
// Job attribute detection
// ---------------------------------------------------------------------------

export function detectRemoteType(...texts: (string | null | undefined)[]): "remote" | "hybrid" | "onsite" | "unknown" {
  const t = normalize(texts.filter(Boolean).join(" "));
  if (/\bhybrid\b/.test(t)) return "hybrid";
  if (/\b(remote|work from home|wfh|anywhere|distributed|telecommute)\b/.test(t)) return "remote";
  if (/\b(on site|onsite|in office|in person|office based)\b/.test(t)) return "onsite";
  return "unknown";
}

export function detectJobType(...texts: (string | null | undefined)[]):
  | "full-time" | "part-time" | "contract" | "freelance" | "internship" | "temporary" | null {
  const t = normalize(texts.filter(Boolean).join(" "));
  if (/\bintern(ship)?\b/.test(t)) return "internship";
  if (/\bfreelanc/.test(t)) return "freelance";
  if (/\b(contract|contractor|c2c|1099)\b/.test(t)) return "contract";
  if (/\b(temporary|temp)\b/.test(t)) return "temporary";
  if (/\bpart time\b|\bpart-time\b/.test(t)) return "part-time";
  if (/\bfull time\b|\bfull-time\b|\bfulltime\b|\bpermanent\b/.test(t)) return "full-time";
  return null;
}

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** Extract required years of experience, e.g. "3+ years", "2-4 years", "minimum of two years". */
export function detectExperience(text: string | null | undefined): { min: number | null; max: number | null } {
  if (!text) return { min: null, max: null };
  const t = text.toLowerCase().replace(/[–—]/g, "-");
  const num = "(\\d{1,2}(?:\\.\\d)?|one|two|three|four|five|six|seven|eight|nine|ten)";
  const toN = (s: string) => (WORD_NUM[s] ?? parseFloat(s));
  const range = new RegExp(`${num}\\s*(?:-|to)\\s*${num}\\s*\\+?\\s*(?:years|yrs|year)`, "i").exec(t);
  if (range) {
    const a = toN(range[1]);
    const b = toN(range[2]);
    if (a <= 20 && b <= 25 && b >= a) return { min: a, max: b };
  }
  const plus = new RegExp(`(?:minimum of |at least |min\\.? )?${num}\\s*\\+?\\s*(?:years|yrs|year)(?:'|’)?\\s*(?:of\\s+)?(?:relevant |professional |work |hands-on |industry )?(?:experience|exp)`, "i").exec(t);
  if (plus) {
    const a = toN(plus[1]);
    if (a <= 20) return { min: a, max: null };
  }
  if (/\b(fresher|freshers|no experience (?:required|needed)|entry[- ]level|graduate program|new grad)\b/.test(t)) return { min: 0, max: 1 };
  return { min: null, max: null };
}

export function detectDegree(text: string | null | undefined): string | null {
  const t = normalize(text);
  if (/\b(phd|ph d|doctorate)\b/.test(t) && /\b(required|must)\b/.test(t)) return "phd";
  if (/\b(master s|masters|m tech|mtech|msc|m sc|mba)\b.{0,40}\b(required|must)\b/.test(t)) return "masters";
  if (/\b(bachelor|bachelors|b tech|btech|b e|be|bsc|b sc|graduate|degree)\b/.test(t)) return "bachelors";
  if (/\bno degree\b|\bdegree not required\b/.test(t)) return "none";
  return null;
}

export function isCodingRole(title: string, description?: string | null): boolean {
  const ti = normalize(title);
  if (/\b(software|engineer|developer|sde|programmer|devops|backend|frontend|full stack|ml engineer|data engineer)\b/.test(ti) && !/\b(prompt engineer|quality|evaluator|annotator|support)\b/.test(ti)) return true;
  const d = normalize(description);
  const codingSignals = ["write production code", "coding interview", "leetcode", "data structures and algorithms", "build and deploy services", "proficiency in java", "strong programming"];
  return codingSignals.some((s) => d.includes(s));
}

export function isAIRelated(...texts: (string | null | undefined)[]): boolean {
  const t = normalize(texts.filter(Boolean).join(" "));
  return /\b(ai|a i|artificial intelligence|machine learning|ml|llm|llms|large language model|genai|generative ai|gen ai|rlhf|annotation|annotator|data labeling|data labelling|prompt|chatbot|model evaluation|nlp|computer vision)\b/.test(t);
}

export function isTechnicalRole(title: string): boolean {
  return /\b(engineer|developer|architect|scientist|devops|sre|programmer|technical)\b/.test(normalize(title));
}

// ---------------------------------------------------------------------------
// Salary parsing — returns annual figures in original currency
// ---------------------------------------------------------------------------
export interface ParsedSalary {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: "year" | "month" | "hour" | null;
}

export function parseSalary(text: string | null | undefined): ParsedSalary {
  const empty: ParsedSalary = { min: null, max: null, currency: null, period: null };
  if (!text) return empty;
  const t = text.replace(/,/g, "").replace(/[–—]/g, "-");
  // Indian LPA formats: "5-8 LPA", "₹6 LPA", "6 lakhs per annum"
  const lpa = /(?:₹|inr|rs\.?)?\s*(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(\d+(?:\.\d+)?)?\s*(?:lpa|lakhs?|lacs?)(?:\s*(?:per annum|p\.?a\.?|\/yr|a year))?/i.exec(t);
  if (lpa) {
    const a = parseFloat(lpa[1]) * 100000;
    const b = lpa[2] ? parseFloat(lpa[2]) * 100000 : null;
    return { min: a, max: b ?? a, currency: "INR", period: "year" };
  }
  let currency: string | null = null;
  if (/\$|usd/i.test(t)) currency = "USD";
  else if (/€|eur/i.test(t)) currency = "EUR";
  else if (/£|gbp/i.test(t)) currency = "GBP";
  else if (/₹|inr|rs\.?\s?\d/i.test(t)) currency = "INR";
  let period: ParsedSalary["period"] = "year";
  if (/(per hour|\/ ?h(ou)?r|hourly|an hour)/i.test(t)) period = "hour";
  else if (/(per month|\/ ?mo(nth)?|monthly|a month)/i.test(t)) period = "month";
  const nums = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(k|m)?\b/gi)]
    .map((m) => {
      let n = parseFloat(m[1]);
      if (m[2]?.toLowerCase() === "k") n *= 1000;
      if (m[2]?.toLowerCase() === "m") n *= 1_000_000;
      return n;
    })
    .filter((n) => n >= 5 && n < 100_000_000);
  if (!nums.length || !currency) return empty;
  const min = nums[0];
  const max = nums[1] && nums[1] >= min ? nums[1] : min;
  return { min, max, currency, period };
}

/** Convert a salary to annual INR for comparison. Returns null when not convertible. */
export function toAnnualINR(
  amount: number | null | undefined,
  currency: string | null | undefined,
  period: string | null | undefined,
  usdInr?: number | null,
): number | null {
  if (amount == null || !currency) return null;
  const mult = period === "hour" ? 2000 : period === "month" ? 12 : 1;
  const annual = amount * mult;
  if (currency === "INR") return annual;
  const rates: Record<string, number> = { USD: 1, EUR: 1.08, GBP: 1.27 };
  if (!usdInr || !rates[currency]) return null;
  return annual * rates[currency] * usdInr;
}

export function toAnnualUSD(
  amount: number | null | undefined,
  currency: string | null | undefined,
  period: string | null | undefined,
  usdInr?: number | null,
): number | null {
  if (amount == null || !currency) return null;
  const mult = period === "hour" ? 2000 : period === "month" ? 12 : 1;
  const annual = amount * mult;
  if (currency === "USD") return annual;
  if (currency === "INR") return usdInr ? annual / usdInr : null;
  const rates: Record<string, number> = { EUR: 1.08, GBP: 1.27 };
  return rates[currency] ? annual * rates[currency] : null;
}

const COUNTRY_WORDS: [RegExp, string][] = [
  [/\b(india|bengaluru|bangalore|mumbai|delhi|new delhi|gurgaon|gurugram|noida|hyderabad|pune|chennai|kolkata|ahmedabad|chandigarh|jaipur|mohali|jalandhar|ludhiana|indore|kochi)\b/, "India"],
  [/\b(united states|usa|u s|us only|new york|san francisco|california|texas|seattle|boston|austin|chicago)\b/, "United States"],
  [/\b(united kingdom|uk|london|england|manchester)\b/, "United Kingdom"],
  [/\b(canada|toronto|vancouver|montreal)\b/, "Canada"],
  [/\b(germany|berlin|munich|hamburg)\b/, "Germany"],
  [/\b(europe|emea|eu)\b/, "Europe"],
  [/\b(philippines|manila)\b/, "Philippines"],
  [/\b(singapore)\b/, "Singapore"],
  [/\b(australia|sydney|melbourne)\b/, "Australia"],
  [/\b(worldwide|anywhere|global|globally)\b/, "Worldwide"],
  [/\b(apac|asia)\b/, "APAC"],
];

export function detectCountries(...texts: (string | null | undefined)[]): string[] {
  const t = normalize(texts.filter(Boolean).join(" "));
  const out = new Set<string>();
  for (const [re, c] of COUNTRY_WORDS) if (re.test(t)) out.add(c);
  return [...out];
}
