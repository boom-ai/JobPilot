// File → plain text for PDF and DOCX resumes (server-only).

export interface ExtractedFile {
  text: string;
  links: string[];
  pages?: number;
}

export async function extractResumeFile(buf: Uint8Array, filename: string, mime?: string): Promise<ExtractedFile> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf") || mime === "application/pdf") return extractPdf(buf);
  if (lower.endsWith(".docx") || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    return extractDocx(buf);
  if (lower.endsWith(".txt") || mime === "text/plain") return { text: new TextDecoder().decode(buf), links: [] };
  throw new Error("Unsupported file type. Upload a PDF or DOCX resume.");
}

async function extractPdf(buf: Uint8Array): Promise<ExtractedFile> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  const links: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const ann = (await page.getAnnotations()) as { url?: string }[];
    for (const a of ann) if (a.url) links.push(a.url);
  }
  if (!text.trim()) throw new Error("No selectable text found in this PDF (it may be a scanned image). Upload a text-based PDF or DOCX.");
  return { text, links, pages: totalPages };
}

async function extractDocx(buf: Uint8Array): Promise<ExtractedFile> {
  const mammoth = await import("mammoth");
  const buffer = Buffer.from(buf);
  const { value } = await mammoth.extractRawText({ buffer });
  const html = (await mammoth.convertToHtml({ buffer })).value;
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  // mammoth separates paragraphs by blank lines; bullets lose their glyphs, so restore them
  const text = value
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n");
  return { text, links };
}

/** Real profile URLs only — bare domains like "https://linkedin.com/" are placeholders, not profiles. */
export function meaningfulLinks(links: string[]): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  for (const url of links) {
    if (url.startsWith("mailto:") || url.startsWith("tel:")) continue;
    try {
      const u = new URL(url);
      if (u.pathname === "/" || u.pathname === "") continue;
      const label = /linkedin/.test(u.host) ? "LinkedIn" : /github/.test(u.host) ? "GitHub" : "Website";
      if (!out.some((l) => l.url === url)) out.push({ label, url });
    } catch {
      /* ignore */
    }
  }
  return out;
}
