// Job Pilot local worker — run on your own computer: `npm run worker`
//  - processes the agent queue (searches, analysis, tailoring, preparation)
//  - runs browser tasks (assisted fill / permitted auto-submit) in a visible Chrome window
//  - runs scheduled saved searches and daily status monitoring
import "dotenv/config";
import { config as loadEnv } from "dotenv";
import cron from "node-cron";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright-core";
import { adminClient, isLocalMode, type DB } from "../src/lib/supabase/clients";
import { localDb } from "../src/lib/supabase/localdb";
import { processTasks } from "../src/lib/agent/runner";
import { enqueue, requeueStale } from "../src/lib/agent/queue";
import { scheduleDueSearches } from "../src/lib/agent/services";
import { defaultDataDir, makeBrowserHandler } from "./ats-handler";

loadEnv({ path: ".env.local" });

const WORKER_ID = `worker-${process.pid}`;
const INTERVAL = Number(process.env.WORKER_INTERVAL_SECONDS ?? 30) * 1000;
const dataDir = defaultDataDir();
const db: DB = isLocalMode() ? (localDb() as unknown as DB) : adminClient();

let context: BrowserContext | null = null;
async function getContext(): Promise<BrowserContext> {
  if (context) return context;
  const opts = {
    headless: process.env.WORKER_HEADLESS === "1",
    viewport: { width: 1280, height: 900 },
    // Your installed Chrome. Set CHROME_PATH to use a specific binary, or BROWSER_CHANNEL=msedge.
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: process.env.BROWSER_CHANNEL ?? "chrome" }),
  };
  // Persistent profile = browser-managed sessions/cookies; no passwords are ever stored by Job Pilot.
  context = await chromium.launchPersistentContext(path.join(dataDir, "browser-profile"), opts);
  context.on("close", () => (context = null));
  return context;
}

const handler = makeBrowserHandler(getContext, dataDir);
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    await requeueStale(db);
    if (process.env.WORKER_SCHEDULES !== "0") {
      const q = await scheduleDueSearches(db);
      if (q.length) console.log(`[${new Date().toLocaleTimeString()}] queued ${q.length} scheduled search(es)`);
    }
    const r = await processTasks(db, { workerId: WORKER_ID, limit: 5, allowBrowser: true, browserHandler: handler, secretsDb: db });
    for (const p of r.processed) console.log(`[${new Date().toLocaleTimeString()}] ${p.type} → ${p.status}${p.error ? ` (${p.error})` : ""}`);
  } catch (e) {
    console.error("[worker] tick failed:", (e as Error).message);
  } finally {
    running = false;
  }
}

// Daily status monitoring at 09:00 local time
cron.schedule("0 9 * * *", async () => {
  const { data } = await db.from("user_profiles").select("user_id");
  for (const u of data ?? []) await enqueue(db, u.user_id, "status_monitoring", { dedupe: false });
});

console.log(`Job Pilot worker ${WORKER_ID} — ${isLocalMode() ? "local mode" : "Supabase"} — polling every ${INTERVAL / 1000}s. Ctrl+C to stop.`);
tick();
setInterval(tick, INTERVAL);

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, async () => {
    console.log("Stopping worker…");
    await context?.close().catch(() => {});
    process.exit(0);
  });
