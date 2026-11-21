import { containsTerm, normalize } from "./text";

// Canonical skill → aliases. Used to extract skills from job descriptions and to compare
// against the candidate profile without being fooled by spelling variations.
export const SKILL_ALIASES: Record<string, string[]> = {
  // AI / data operations
  "LLM Evaluation": ["llm evaluation", "model evaluation", "response evaluation", "evaluating ai responses", "ai evaluation", "evaluate ai-generated", "evaluate model outputs", "rating ai responses", "response rating", "ai response evaluation"],
  "Data Annotation": ["data annotation", "annotation", "data labeling", "data labelling", "labeling", "labelling", "annotating", "tagging data"],
  "RLHF": ["rlhf", "reinforcement learning from human feedback", "human feedback", "preference ranking", "preference data"],
  "Prompt Engineering": ["prompt engineering", "prompt writing", "prompt design", "writing prompts", "prompting"],
  "Image Annotation": ["image annotation", "bounding box", "bounding boxes", "image labeling", "segmentation"],
  "Quality Assurance": ["quality assurance", "qa", "quality control", "qc", "quality review", "quality checks"],
  "Fact-checking": ["fact checking", "fact-checking", "factuality", "factual accuracy", "verify facts"],
  "Search Quality Rating": ["search quality", "search evaluation", "ads quality", "relevance rating", "rater guidelines"],
  "Content Moderation": ["content moderation", "trust and safety", "trust & safety", "policy enforcement", "safety compliance"],
  "Guideline Adherence": ["evaluation guidelines", "follow guidelines", "detailed guidelines", "annotation guidelines", "style guide"],
  "Generative AI": ["generative ai", "genai", "gen ai", "large language models", "llms", "llm"],
  "NLP": ["nlp", "natural language processing"],
  "Machine Learning": ["machine learning", "ml models"],
  // analytics
  "Microsoft Excel": ["excel", "microsoft excel", "ms excel", "spreadsheets", "google sheets"],
  "Power BI": ["power bi", "powerbi"],
  "Tableau": ["tableau"],
  "Data Visualization": ["data visualization", "data visualisation", "dashboards", "dashboarding"],
  "Data Analysis": ["data analysis", "data analytics", "analyzing data", "analysing data"],
  "SQL": ["sql", "mysql", "postgresql", "postgres", "sqlite"],
  // engineering
  "Python": ["python"],
  "JavaScript": ["javascript", "js", "node.js", "nodejs"],
  "TypeScript": ["typescript"],
  "Kotlin": ["kotlin"],
  "Java": ["java"],
  "HTML": ["html", "html5"],
  "CSS": ["css", "css3", "tailwind"],
  "React": ["react", "react.js", "reactjs"],
  "Django": ["django"],
  "Android SDK": ["android sdk", "android development", "android"],
  "MongoDB": ["mongodb", "mongo"],
  "Room Database": ["room database", "room db"],
  "Git": ["git", "github", "gitlab"],
  "AWS": ["aws", "amazon web services"],
  "Android Studio": ["android studio"],
  "n8n": ["n8n"],
  "Make.com": ["make.com", "integromat"],
  "Workflow Automation": ["workflow automation", "automation workflows", "process automation", "zapier"],
  "REST APIs": ["rest api", "rest apis", "restful", "api integration", "backend apis"],
  "Software Testing": ["software testing", "manual testing", "test cases", "bug reporting", "regression testing", "uat"],
  "Go": ["golang", "go lang"],
  "C++": ["c++", "cpp"],
  "C#": ["c#", ".net", "dotnet"],
  "Docker": ["docker", "containers"],
  "Kubernetes": ["kubernetes", "k8s"],
  "GCP": ["gcp", "google cloud"],
  "Azure": ["azure"],
  "PyTorch": ["pytorch"],
  "TensorFlow": ["tensorflow"],
  "Pandas": ["pandas"],
  "Statistics": ["statistics", "statistical analysis"],
  "Jira": ["jira"],
  "Selenium": ["selenium", "playwright", "cypress"],
  // soft / general
  "Attention to Detail": ["attention to detail", "detail-oriented", "detail oriented", "meticulous", "high accuracy"],
  "Written Communication": ["written communication", "writing skills", "excellent english", "strong english", "english proficiency", "communication skills"],
  "Critical Thinking": ["critical thinking", "analytical skills", "analytical thinking", "problem solving", "problem-solving"],
  "Research": ["research skills", "online research", "researching"],
  "Hindi": ["hindi"],
  "Punjabi": ["punjabi"],
  "English": ["english"],
};

const ALIAS_INDEX: { canonical: string; alias: string }[] = Object.entries(SKILL_ALIASES).flatMap(
  ([canonical, aliases]) => [canonical, ...aliases].map((alias) => ({ canonical, alias })),
);

/** Map any free-form skill string to its canonical name (or itself, title-cased). */
export function canonicalSkill(s: string): string {
  const n = normalize(s);
  for (const { canonical, alias } of ALIAS_INDEX) if (normalize(alias) === n) return canonical;
  return s.trim();
}

/** Skills mentioned in free text, as canonical names. Ambiguous short aliases need word boundaries. */
export function extractSkills(text: string | null | undefined): string[] {
  const n = normalize(text);
  if (!n) return [];
  const found = new Set<string>();
  for (const { canonical, alias } of ALIAS_INDEX) {
    if (alias === "qa" || alias === "js" || alias === "android" || alias === "llm" || alias === "english") {
      if (containsTerm(n, alias)) found.add(canonical);
      continue;
    }
    if (containsTerm(n, alias)) found.add(canonical);
  }
  // Java false positive when only JavaScript is mentioned
  if (found.has("Java") && !/\bjava\b(?!script)/.test(n.replace(/java script/g, "javascript"))) found.delete("Java");
  return [...found];
}

/** Candidate skills = explicit skills + skills evidenced in experience/project text. */
export function profileSkillSet(profile: {
  skills: { items: string[] }[];
  experience: { bullets: { text: string }[]; title: string }[];
  projects: { bullets: { text: string }[]; technologies?: string[]; description?: string }[];
  summary?: string;
  languages?: { name: string }[];
}): { explicit: Set<string>; evidenced: Set<string> } {
  const explicit = new Set<string>();
  for (const g of profile.skills) for (const s of g.items) explicit.add(canonicalSkill(s));
  for (const l of profile.languages ?? []) explicit.add(canonicalSkill(l.name));
  const textParts: string[] = [profile.summary ?? ""];
  for (const e of profile.experience) textParts.push(e.title, ...e.bullets.map((b) => b.text));
  for (const p of profile.projects) textParts.push(p.description ?? "", ...(p.technologies ?? []), ...p.bullets.map((b) => b.text));
  const evidenced = new Set(extractSkills(textParts.join("\n")));
  for (const s of explicit) for (const e of extractSkills(s)) evidenced.add(e);
  return { explicit, evidenced };
}
