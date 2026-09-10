// Explicit opt-in only. Sends ONLY authored teaching-stories.json in a fresh
// browser context to the locally configured OpenAI endpoint; no saved sessions.
import { chromium } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
if (!process.argv.includes("--live"))
  throw new Error(
    "Use --live only for an authorized provider run. Offline tests do not call providers.",
  );
const story = JSON.parse(
  await readFile("tests/real/teaching-stories.json", "utf8"),
);
const scenario =
  process.argv.find((a) => a.startsWith("--scenario="))?.split("=")[1] ??
  "sequence";
const scenarios = {
  sequence: story.steps,
  correction: [story.steps[2], story.steps[3]],
  cue: [story.steps[0], story.steps[4]],
  incomplete: [story.steps[6], story.steps[7]],
  repeat: [story.steps[0], story.steps[1], story.steps[5]],
};
if (!scenarios[scenario]) throw new Error("unknown scenario");
const steps = scenarios[scenario];
const limit = Number(
  process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ??
    steps.length,
);
const output = resolve(
  "../../.cuelayer/v2/real",
  new Date().toISOString().replaceAll(":", "-"),
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  reducedMotion: "reduce",
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(
    `http://127.0.0.1:5192/?services=real&session=authored-${crypto.randomUUID()}`,
  );
  await page.waitForFunction(() => Boolean(window.v2));
  const config = await page.evaluate(() =>
    fetch("/api/v2/config").then((r) => r.json()),
  );
  const rows = [];
  for (const step of steps.slice(0, limit)) {
    await page.evaluate((text) => window.v2.inject(text), step.text);
    await page.waitForFunction(
      () =>
        window.v2.session.error ||
        window.v2.session.window.livePendingCount === 0,
      null,
      { timeout: 30000 },
    );
    await page.waitForTimeout(300);
    const snapshot = await page.evaluate(() => ({
      ...window.v2.snapshot(),
      error: window.v2.session.error,
      dom: document.body.innerText,
    }));
    snapshot.events = await page.evaluate(() =>
      window.v2.session.store.read(window.v2.session.id),
    );
    rows.push({ step, ...snapshot });
    await page.screenshot({ path: resolve(output, `${step.id}.png`) });
    console.log(
      JSON.stringify({
        step: step.id,
        error: snapshot.error,
        consumed: snapshot.window.consumedEvidenceIds.length,
        units: Object.values(snapshot.state.units).map((u) => ({
          id: u.id,
          version: u.version,
          meaning: u.meaning,
        })),
        unresolved: Object.keys(snapshot.replay.unresolved).length,
      }),
    );
    if (snapshot.error) break; // Preserve failed prefix; no automatic semantic retry/tuning.
  }
  await writeFile(
    resolve(output, "run.json"),
    JSON.stringify(
      {
        identity: story.identity,
        scenario,
        source: story.source,
        config,
        errors,
        rows,
      },
      null,
      2,
    ),
  );
  console.log(`Local evidence: ${output}`);
} finally {
  await browser.close();
}
