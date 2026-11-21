// ATS-friendly exports: single column, standard headings, no tables/graphics.
import { AlignmentType, Document, ExternalHyperlink, Packer, Paragraph, TextRun, BorderStyle } from "docx";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { TailoredResume, SectionName } from "./tailor";

const HEADINGS: Record<SectionName, string> = {
  summary: "Professional Summary",
  skills: "Skills",
  experience: "Professional Experience",
  projects: "Projects",
  education: "Education",
  certifications: "Certifications",
  achievements: "Achievements",
  languages: "Languages",
};

function visibleSections(r: TailoredResume): SectionName[] {
  return r.section_order.filter((s) => !r.hidden_sections.includes(s) && hasContent(r, s));
}

function hasContent(r: TailoredResume, s: SectionName): boolean {
  switch (s) {
    case "summary": return !!r.summary.trim();
    case "skills": return r.skills.some((g) => g.items.length);
    case "experience": return r.experience.length > 0;
    case "projects": return r.projects.length > 0;
    case "education": return r.education.length > 0;
    case "certifications": return r.certifications.length > 0;
    case "achievements": return r.achievements.length > 0;
    case "languages": return r.languages.length > 0;
  }
}

function dateRange(a?: string, b?: string) {
  return [a, b].filter(Boolean).join(" – ");
}

function contactLine(r: TailoredResume): string {
  return [r.header.location, r.header.phone, r.header.email].filter(Boolean).join(" | ");
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------
export async function resumeToDocx(r: TailoredResume): Promise<Buffer> {
  const children: Paragraph[] = [];
  const font = "Calibri";
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: r.header.name, bold: true, size: 32, font })] }));
  if (r.headline) children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: r.headline, size: 21, font })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: contactLine(r), size: 20, font })] }));
  if (r.header.links.length) {
    const runs: (TextRun | ExternalHyperlink)[] = [];
    r.header.links.forEach((l, i) => {
      if (i) runs.push(new TextRun({ text: " | ", size: 20, font }));
      runs.push(new ExternalHyperlink({ link: l.url, children: [new TextRun({ text: l.url.replace(/^https?:\/\/(www\.)?/, ""), style: "Hyperlink", size: 20, font })] }));
    });
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: runs }));
  }
  const heading = (t: string) =>
    new Paragraph({
      spacing: { before: 200, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 2 } },
      children: [new TextRun({ text: t.toUpperCase(), bold: true, size: 22, font })],
    });
  const bullet = (t: string) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 30 }, children: [new TextRun({ text: t, size: 21, font })] });
  const line = (left: string, right?: string, bold = false) =>
    new Paragraph({
      tabStops: [{ type: "right", position: 10000 }],
      spacing: { before: 80 },
      children: [new TextRun({ text: left, bold, size: 21, font }), ...(right ? [new TextRun({ text: `\t${right}`, size: 21, font })] : [])],
    });

  for (const s of visibleSections(r)) {
    children.push(heading(HEADINGS[s]));
    if (s === "summary") children.push(new Paragraph({ children: [new TextRun({ text: r.summary, size: 21, font })] }));
    if (s === "skills")
      for (const g of r.skills.filter((g) => g.items.length))
        children.push(new Paragraph({ spacing: { after: 30 }, children: [new TextRun({ text: `${g.category}: `, bold: true, size: 21, font }), new TextRun({ text: g.items.join(", "), size: 21, font })] }));
    if (s === "experience")
      for (const e of r.experience) {
        children.push(line(e.title, dateRange(e.start, e.end), true));
        children.push(new Paragraph({ children: [new TextRun({ text: [e.company, e.location].filter(Boolean).join(", "), italics: true, size: 21, font })] }));
        for (const b of e.bullets) children.push(bullet(b.text));
      }
    if (s === "projects")
      for (const p of r.projects) {
        children.push(line(p.technologies?.length ? `${p.name} (${p.technologies.join(", ")})` : p.name, undefined, true));
        for (const b of p.bullets) children.push(bullet(b.text));
      }
    if (s === "education")
      for (const ed of r.education) {
        children.push(line([ed.degree, ed.field].filter(Boolean).join(" – "), dateRange(ed.start, ed.end), true));
        children.push(new Paragraph({ children: [new TextRun({ text: [ed.institution, ed.grade].filter(Boolean).join(" | "), size: 21, font })] }));
      }
    if (s === "certifications") for (const c of r.certifications) children.push(bullet([c.name, c.issuer].filter(Boolean).join(" – ")));
    if (s === "achievements") for (const a of r.achievements) children.push(bullet(a.text));
    if (s === "languages") children.push(new Paragraph({ children: [new TextRun({ text: r.languages.map((l) => (l.proficiency ? `${l.name} (${l.proficiency})` : l.name)).join(", "), size: 21, font })] }));
  }
  const doc = new Document({
    creator: "Job Pilot AI",
    title: `${r.header.name} — Resume`,
    numbering: { config: [] },
    sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } }, children }],
  });
  return Packer.toBuffer(doc);
}

// ---------------------------------------------------------------------------
// PDF (standard Helvetica — WinAnsi; unsupported glyphs are transliterated)
// ---------------------------------------------------------------------------
const GLYPH_MAP: Record<string, string> = { "₹": "Rs.", "→": "->", "←": "<-", "✓": "", " ": " ", "\t": " " };
const WINANSI_EXTRA = "–—•“”‘’…€™‚„†‡ˆ‰Š‹ŒŽ˜šœžŸ";

/** Standard PDF fonts only cover WinAnsi; transliterate everything else instead of crashing. */
export function pdfSafe(s: string): string {
  let out = "";
  for (const ch of s) {
    if (GLYPH_MAP[ch] !== undefined) out += GLYPH_MAP[ch];
    else if ((ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) < 127) || (ch.charCodeAt(0) >= 160 && ch.charCodeAt(0) < 256) || WINANSI_EXTRA.includes(ch)) out += ch;
    else out += ch.normalize("NFKD").replace(/[^\x20-\x7e]/g, "");
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) <= width) cur = t;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export async function resumeToPdf(r: TailoredResume): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${r.header.name} — Resume`);
  pdf.setAuthor(r.header.name);
  pdf.setCreator("Job Pilot AI");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const W = 595.28;
  const H = 841.89;
  const M = 50;
  const CW = W - 2 * M;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const ensure = (h: number) => {
    if (y - h < M) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };
  const text = (t: string, opts: { font?: PDFFont; size?: number; x?: number; center?: boolean; color?: [number, number, number] } = {}) => {
    const f = opts.font ?? regular;
    const size = opts.size ?? 10;
    const s = pdfSafe(t);
    ensure(size + 3);
    const x = opts.center ? (W - f.widthOfTextAtSize(s, size)) / 2 : opts.x ?? M;
    page.drawText(s, { x, y: y - size, size, font: f, color: rgb(...(opts.color ?? [0.08, 0.08, 0.08])) });
    y -= size + 3.5;
  };
  const para = (t: string, opts: { font?: PDFFont; size?: number; indent?: number; bulletGlyph?: boolean } = {}) => {
    const f = opts.font ?? regular;
    const size = opts.size ?? 10;
    const indent = opts.indent ?? 0;
    const lines = wrap(pdfSafe(t), f, size, CW - indent - (opts.bulletGlyph ? 10 : 0));
    lines.forEach((l, i) => {
      ensure(size + 3);
      if (opts.bulletGlyph && i === 0) page.drawText("•", { x: M + indent, y: y - size, size, font: regular });
      page.drawText(l, { x: M + indent + (opts.bulletGlyph ? 10 : 0), y: y - size, size, font: f, color: rgb(0.08, 0.08, 0.08) });
      y -= size + 3.5;
    });
  };
  const rightAligned = (left: string, right: string, f: PDFFont) => {
    ensure(14);
    const size = 10.5;
    page.drawText(pdfSafe(left), { x: M, y: y - size, size, font: f });
    const rs = pdfSafe(right);
    if (rs) page.drawText(rs, { x: W - M - regular.widthOfTextAtSize(rs, 10), y: y - size, size: 10, font: regular });
    y -= size + 4;
  };
  const heading = (t: string) => {
    y -= 6;
    ensure(22);
    text(t.toUpperCase(), { font: bold, size: 11 });
    page.drawLine({ start: { x: M, y: y + 1 }, end: { x: W - M, y: y + 1 }, thickness: 0.6, color: rgb(0.6, 0.6, 0.6) });
    y -= 5;
  };

  text(r.header.name, { font: bold, size: 18, center: true });
  if (r.headline) text(r.headline, { size: 10.5, center: true });
  text(contactLine(r), { size: 9.5, center: true });
  if (r.header.links.length) text(r.header.links.map((l) => l.url.replace(/^https?:\/\/(www\.)?/, "")).join(" | "), { size: 9.5, center: true });

  for (const s of visibleSections(r)) {
    heading(HEADINGS[s]);
    if (s === "summary") para(r.summary);
    if (s === "skills")
      for (const g of r.skills.filter((g) => g.items.length)) para(`${g.category}: ${g.items.join(", ")}`);
    if (s === "experience")
      for (const e of r.experience) {
        y -= 2;
        rightAligned(e.title, dateRange(e.start, e.end), bold);
        para([e.company, e.location].filter(Boolean).join(", "), { font: italic });
        for (const b of e.bullets) para(b.text, { bulletGlyph: true, indent: 4 });
      }
    if (s === "projects")
      for (const p of r.projects) {
        y -= 2;
        para(p.technologies?.length ? `${p.name} (${p.technologies.join(", ")})` : p.name, { font: bold });
        for (const b of p.bullets) para(b.text, { bulletGlyph: true, indent: 4 });
      }
    if (s === "education")
      for (const ed of r.education) {
        rightAligned([ed.degree, ed.field].filter(Boolean).join(" – "), dateRange(ed.start, ed.end), bold);
        para([ed.institution, ed.grade].filter(Boolean).join(" | "));
      }
    if (s === "certifications") for (const c of r.certifications) para([c.name, c.issuer].filter(Boolean).join(" – "), { bulletGlyph: true, indent: 4 });
    if (s === "achievements") for (const a of r.achievements) para(a.text, { bulletGlyph: true, indent: 4 });
    if (s === "languages") para(r.languages.map((l) => (l.proficiency ? `${l.name} (${l.proficiency})` : l.name)).join(", "));
  }
  return pdf.save();
}

// ---------------------------------------------------------------------------
// Plain text documents (cover letters etc.)
// ---------------------------------------------------------------------------
export async function textToDocx(title: string, body: string): Promise<Buffer> {
  const doc = new Document({
    title,
    sections: [{ children: body.split(/\n/).map((l) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: l, size: 22, font: "Calibri" })] })) }],
  });
  return Packer.toBuffer(doc);
}

export async function textToPdf(title: string, body: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const W = 595.28;
  const H = 841.89;
  const M = 60;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  for (const raw of body.split("\n")) {
    const lines = raw.trim() ? wrap(pdfSafe(raw), font, 11, W - 2 * M) : [""];
    for (const l of lines) {
      if (y < M + 14) {
        page = pdf.addPage([W, H]);
        y = H - M;
      }
      page.drawText(l, { x: M, y: y - 11, size: 11, font });
      y -= 15;
    }
    y -= 4;
  }
  return pdf.save();
}
