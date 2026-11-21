import fs from "node:fs";
import path from "node:path";
import { parseResumeText } from "@/lib/resume/parse";
import type { NormalizedJob } from "@/lib/types";

export const fixture = (f: string) => fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8");
export const sampleProfile = () => parseResumeText(fixture("resume_sample.txt"));

export const llmEvalJob: NormalizedJob = {
  title: "LLM Evaluator (Remote)",
  company: "Acme AI",
  location: "Remote - India",
  remote_type: "remote",
  job_type: "contract",
  source: "test",
  source_url: "https://jobs.example.com/acme/llm-evaluator?utm_source=x",
  description: `We are hiring LLM Evaluators to rate AI responses for factual accuracy and instruction following.
Requirements:
• 1+ years of experience in data annotation, RLHF or AI evaluation
• Excellent written English and attention to detail
• Experience following detailed evaluation guidelines
• Bachelor's degree preferred
Nice to have: Python, prompt engineering.`,
};

export const seniorEngJob: NormalizedJob = {
  title: "Senior Backend Engineer",
  company: "BigCo",
  location: "San Francisco, CA",
  remote_type: "onsite",
  job_type: "full-time",
  source: "test",
  description: "7+ years of experience building distributed systems in Java and Go. Strong programming skills, Kubernetes, AWS.",
};
