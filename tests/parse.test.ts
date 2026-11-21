import { describe, expect, it } from "vitest";
import { experienceYears, parseMonth } from "@/lib/resume/parse";
import { meaningfulLinks } from "@/lib/resume/extract";
import { sampleProfile } from "./helpers";

describe("resume parser (real resume)", () => {
  const p = sampleProfile();
  it("extracts contact details", () => {
    expect(p.name).toBe("Sanket Sharma");
    expect(p.email).toBe("sanketsharma8083@gmail.com");
    expect(p.phone).toContain("7973798820");
    expect(p.location).toBe("Jalandhar, Punjab, India");
  });
  it("flags missing LinkedIn/GitHub URLs instead of inventing them", () => {
    expect(p.links).toEqual([]);
    expect(p.unknown_fields).toContain("LinkedIn URL");
    expect(p.unknown_fields).toContain("GitHub URL");
  });
  it("extracts experience with companies, dates and all bullets", () => {
    expect(p.experience).toHaveLength(2);
    expect(p.experience[0]).toMatchObject({ title: "Analyst – AI/LLM Practice", company: "Innodata India Pvt. Ltd.", start: "Dec 2025", end: "Jul 2026" });
    expect(p.experience[0].bullets).toHaveLength(6);
    expect(p.experience[0].bullets[0].text).toMatch(/^Evaluated AI-generated responses.*quality standards\.$/);
    expect(p.experience[1].employment_type).toBe("internship");
    expect(p.experience[1].bullets).toHaveLength(4);
  });
  it("joins hyphenated line wraps", () => {
    expect(p.summary).toContain("quality assurance");
    expect(p.summary).toContain("maintaining high accuracy");
  });
  it("extracts projects, education, skills, certs, languages", () => {
    expect(p.projects.map((x) => x.name)).toContain("GitaFlow Mobile Application");
    expect(p.projects.find((x) => x.name === "Android Expense Calculator")?.technologies).toEqual(["Kotlin", "Room Database"]);
    expect(p.education[0]).toMatchObject({ institution: "DAV Institute of Engineering and Technology", grade: "CGPA: 7.63" });
    expect(p.skills.find((g) => g.category === "AI & Data Operations")?.items).toEqual(["LLM Evaluation", "Data Annotation", "Prompt Engineering", "RLHF"]);
    expect(p.certifications).toHaveLength(4);
    expect(p.languages.map((l) => l.name)).toEqual(["English", "Hindi", "Punjabi"]);
    expect(p.achievements).toHaveLength(3);
  });
  it("computes experience years with internships at half weight", () => {
    expect(experienceYears(p.experience, new Date("2026-11-22"))).toBeCloseTo(1, 0);
    expect(parseMonth("Dec 2025")?.toISOString().slice(0, 7)).toBe("2025-12");
  });
  it("ignores placeholder profile links", () => {
    expect(meaningfulLinks(["https://linkedin.com/", "mailto:a@b.c", "https://github.com/sanket"])).toEqual([{ label: "GitHub", url: "https://github.com/sanket" }]);
  });
});
