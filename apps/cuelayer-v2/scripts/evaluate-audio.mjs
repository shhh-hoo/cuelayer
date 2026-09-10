// Authorized generated-audio replay, explicitly NOT an owner microphone trial.
import { chromium } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
if (!process.argv.includes("--generated-audio"))
  throw new Error(
    "Explicit --generated-audio required; see the runbook's authored source and local generation command.",
  );
const audio = resolve("../../.cuelayer/v2/real/generated-speech.wav");
const source = await readFile(
  "../../.cuelayer/v2/real/generated-speech.txt",
  "utf8",
);
const sha256 = createHash("sha256")
  .update(await readFile(audio))
  .digest("hex");
const duration = Number(
  execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      audio,
    ],
    { encoding: "utf8" },
  ),
);
if (!Number.isFinite(duration) || duration <= 0 || duration > 120)
  throw new Error(
    "Audio must contain 0–120 seconds of the reviewed generated story before any provider connection.",
  );
const output = resolve(
  "../../.cuelayer/v2/real",
  `audio-${new Date().toISOString().replaceAll(":", "-")}`,
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${audio}%noloop`,
  ],
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  reducedMotion: "reduce",
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(
    `http://127.0.0.1:5192/?services=real&session=audio-replay-${crypto.randomUUID()}`,
  );
  await page.waitForFunction(() => Boolean(window.v2));
  const config = await page.evaluate(() =>
    fetch("/api/v2/config").then((r) => r.json()),
  );
  await page.getByRole("button", { name: "Enable microphone" }).click();
  await page.waitForFunction(
    () => ["listening", "failed"].includes(window.v2.mic.status),
    null,
    { timeout: 30000 },
  );
  const samples = [];
  if ((await page.evaluate(() => window.v2.mic.status)) === "listening") {
    for (let i = 0; i < (duration + 3) * 2; i++) {
      await page.waitForTimeout(500);
      samples.push(
        await page.evaluate(() => ({
          at: performance.now(),
          window: window.v2.session.window,
          microphone: window.v2.mic.status,
          error: window.v2.session.error,
        })),
      );
    }
    await page.evaluate(() => window.v2.mic.stop());
    await page.waitForFunction(() =>
      ["stopped", "failed"].includes(window.v2.mic.status),
    );
    await page
      .waitForFunction(
        () =>
          window.v2.session.error ||
          window.v2.session.window.livePendingCount === 0,
        null,
        { timeout: 35000 },
      )
      .catch(() => {}); // Bounded observation: backlog is a measured outcome, not a harness exception.
  }
  const snapshot = await page.evaluate(() => ({
    ...window.v2.snapshot(),
    error: window.v2.session.error,
    microphone: {
      status: window.v2.mic.status,
      error: window.v2.mic.error,
      pendingCount: window.v2.mic.pendingCount,
      audioSeconds: window.v2.mic.audioSeconds,
    },
    dom: document.body.innerText,
  }));
  snapshot.events = await page.evaluate(() =>
    window.v2.session.store.read(window.v2.session.id),
  );
  await page.screenshot({ path: resolve(output, "surface.png") });
  await writeFile(
    resolve(output, "run.json"),
    JSON.stringify(
      {
        identity: "cuelayer-v2-generated-audio-1",
        source,
        sha256,
        duration,
        config,
        errors,
        samples,
        snapshot,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      output,
      microphone: snapshot.microphone,
      error: snapshot.error,
      evidence: snapshot.replay.evidence.map((e) => ({
        sequence: e.sequence,
        text: e.text,
        start: e.start,
        end: e.end,
        audioObservedAt: e.audioObservedAt,
      })),
      consumed: snapshot.window.consumedEvidenceIds.length,
      units: Object.values(snapshot.state.units).map((u) => u.meaning),
    }),
  );
} catch (error) {
  const snapshot = await page
    .evaluate(async () => ({
      ...window.v2.snapshot(),
      events: await window.v2.session.store.read(window.v2.session.id),
      error: window.v2.session.error,
      microphone: { status: window.v2.mic.status, error: window.v2.mic.error },
      dom: document.body.innerText,
    }))
    .catch(() => null);
  await writeFile(
    resolve(output, "failure.json"),
    JSON.stringify({ error: String(error), snapshot }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
