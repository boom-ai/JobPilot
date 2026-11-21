import { afterEach, describe, expect, it, vi } from "vitest";
import { tailorResume, tailorWithRules, validateRewrite, makeFileName, wordDiff } from "@/lib/resume/tailor";
import { resumeToDocx, resumeToPdf, pdfSafe } from "@/lib/resume/export";
import { extractResumeFile } from "@/lib/resume/extract";
import { parseResumeText } from "@/lib/resume/parse";
import { letterTemplate, answerQuestions, unsupportedNumbers, findLibraryAnswer } from "@/lib/ai/tasks";
import { DEFAULT_PREFERENCES } from "@/lib/defaults";
import { llmEvalJob, sampleProfile } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

function mockGemini(payload: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }), { status: 200 })));
}

describe("truth guards", () => {
  it("rejects invented metrics and skills", () => {
    const src = "Evaluated AI-generated responses for factual accuracy and quality standards.";
    expect(validateRewrite(src, "Evaluated 5,000+ AI responses for factual accuracy.", new Set())).toMatch(/number/);
    expect(validateRewrite(src, "Evaluated AI responses using Python and SQL for accuracy.", new Set())).toMatch(/skill/);
    expect(validateRewrite(src, "Assessed AI-generated responses for factual accuracy and adherence to quality standards.", new Set())).toBeNull();
  });

  it("applies valid AI rewrites and reverts fabricated ones", async () => {
    const p = sampleProfile();
    const b0 = p.experience[0].bullets[0];
    const b1 = p.experience[0].bullets[1];
    mockGemini({
      summary: "Detail-oriented AI/LLM evaluation analyst with 5 years of experience in Kubernetes.",
      bullets: [
        { source_id: b0.id, text: "Assessed AI-generated responses for factual accuracy, contextual relevance, safety compliance and quality standards." },
        { source_id: b1.id, text: "Annotated 10,000 samples per week for LLM training using RLHF." },
        { source_id: "made_up", text: "Led a team of 20 annotators at Google." },
      ],
      skill_order: ["RLHF", "LLM Evaluation"],
    });
    const { resume, method, issues } = await tailorResume(p, llmEvalJob, { provider: "gemini", model: "x", apiKey: "k" });
    expect(method).toBe("ai");
    const all = resume.experience.flatMap((e) => e.bullets);
    expect(all.find((b) => b.source_id === b0.id)?.changed).toBe(true);
    expect(all.find((b) => b.source_id === b1.id)?.text).toBe(b1.text); // reverted
    expect(all.some((b) => /Google/.test(b.text))).toBe(false);
    expect(resume.summary).toBe(resume.summary_original === resume.summary ? resume.summary : resume.summary);
    expect(resume.summary).not.toMatch(/Kubernetes|5 years/);
    expect(issues.map((i) => i.source_id)).toEqual(expect.arrayContaining([b1.id, "made_up", "summary"]));
    // employers, titles, dates always from the profile
    expect(resume.experience.map((e) => [e.company, e.title, e.start, e.end])).toEqual(p.experience.map((e) => [e.company, e.title, e.start, e.end]));
    expect(resume.skills.find((g) => g.category === "AI & Data Operations")?.items[0]).toBe("RLHF");
  });

  it("falls back to rules when AI errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 400 })));
    const { method, resume } = await tailorResume(sampleProfile(), llmEvalJob, { provider: "gemini", model: "x", apiKey: "k" });
    expect(method).toBe("rules");
    expect(resume.warnings.join(" ")).toMatch(/AI rewrite unavailable/);
  });

  it("never adds skills the profile lacks", () => {
    const t = tailorWithRules(sampleProfile(), { ...llmEvalJob, description: llmEvalJob.description + "\nMust know Kubernetes and Tableau." });
    const skills = t.skills.flatMap((g) => g.items);
    expect(skills).not.toContain("Kubernetes");
    expect(t.keywords.not_claimed).toContain("Kubernetes");
  });
});

describe("exports", () => {
  it("builds PDF and DOCX that round-trip through the parser", async () => {
    const t = tailorWithRules(sampleProfile(), llmEvalJob);
    const pdf = await resumeToPdf(t);
    const docx = await resumeToDocx(t);
    const fromPdf = await extractResumeFile(pdf, "x.pdf");
    const fromDocx = await extractResumeFile(new Uint8Array(docx), "x.docx");
    for (const txt of [fromPdf.text, fromDocx.text]) {
      expect(txt).toContain("Sanket Sharma");
      expect(txt).toContain("Innodata India Pvt. Ltd.");
      const reparsed = parseResumeText(txt);
      expect(reparsed.email).toBe("sanketsharma8083@gmail.com");
      expect(reparsed.experience.length).toBe(2);
    }
    expect(makeFileName({ company: "Acme AI", title: "LLM Evaluator (Remote)" }, new Date("2026-11-22"))).toBe("Acme_AI_LLM_Evaluator_Remote_Resume_2026-11-22");
  });
  it("sanitises glyphs standard PDF fonts cannot encode", () => {
    expect(pdfSafe("₹7 LPA → ok ✓")).toBe("Rs.7 LPA -> ok ");
  });
  it("word diff", () => {
    expect(wordDiff("a b c", "a x c").filter((d) => d.type !== "same").map((d) => d.text.trim())).toEqual(["b", "x"]);
  });
});

describe("letters & answers without AI", () => {
  const p = sampleProfile();
  it("template cover letter uses only profile facts", () => {
    const { content } = letterTemplate(p, llmEvalJob, "cover_letter");
    expect(content).toContain("Acme AI");
    expect(content).toContain("Innodata");
    expect(unsupportedNumbers(content, JSON.stringify(p), llmEvalJob.description!)).toEqual([]);
  });
  it("flags unknown notice period / salary instead of guessing", async () => {
    const out = await answerQuestions(null, p, DEFAULT_PREFERENCES, [], llmEvalJob, ["What is your notice period?", "Salary expectations?"]);
    expect(out[0].answer).toBe("");
    expect(out[0].flags[0]).toMatch(/Unknown/);
  });
  it("reuses verified library answers", async () => {
    const lib = [{ key: "notice_period", question: "Notice period?", answer: "Immediate (0 days)", verified: true }];
    expect(findLibraryAnswer("How soon can you join?", lib)?.answer).toBe("Immediate (0 days)");
    const out = await answerQuestions(null, p, DEFAULT_PREFERENCES, lib, llmEvalJob, ["What is your notice period?", "Describe your annotation experience."]);
    expect(out[0]).toMatchObject({ source: "library", answer: "Immediate (0 days)" });
    expect(out[1].answer).toMatch(/Innodata/);
  });
});
