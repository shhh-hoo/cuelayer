import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { loadInput, splitSegments, bytesHash, type SplitStrategy } from "./lesson-replay/input.ts";
import { mockInterpreter, configuredInterpreter, requestConfiguration } from "./lesson-replay/provider.ts";
import { runReplay, type TimelineRow } from "./lesson-replay/runner.ts";
import { buildReport, serializeEvidence } from "./lesson-replay/report.ts";
import { replayLessonEvents } from "../src/lesson-stream/replay.ts";
import type { LessonEvent } from "../src/lesson-stream/contracts.ts";

const { values } = parseArgs({ options: {
  input: { type: "string" }, mode: { type: "string", default: "sequential" }, provider: { type: "string", default: "mock" }, out: { type: "string" },
  split: { type: "string", default: "original" }, "allow-configured": { type: "boolean", default: false },
  "max-attempts": { type: "string" }, "max-runtime-ms": { type: "string" }, "mock-delay-ms": { type: "string", default: "25" },
  "mock-plan": { type: "string" }, "replay-events": { type: "string" }, help: { type: "boolean" },
} });
if (values.help) {
  console.log("eval:lesson-replay -- --input manifest.json --mode sequential|realtime --provider mock|configured --out .cuelayer/replays/run-name\nDefault mock. Configured requires --allow-configured --max-attempts N --max-runtime-ms N and OPENAI_API_KEY.\n--split original|sentence|phrase; --mock-plan plan.json; --replay-events lesson-events.jsonl performs event replay only.");
} else {
  const out = resolve(values.out ?? `.cuelayer/lesson-replay/${randomUUID()}`);
  if (existsSync(out)) throw new Error("output-directory-already-exists: use an independent run directory");
  mkdirSync(out, { recursive: true });
  const save = (name: string, value: unknown) => writeFileSync(resolve(out, name), serializeEvidence(value) + "\n");
  try {
    if (values["replay-events"]) {
      if (values.input || values.provider !== "mock" || values["allow-configured"]) throw new Error("event-replay-does-not-accept-provider-or-input-options");
      const bytes = readFileSync(values["replay-events"]);
      const events = bytes.toString("utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as LessonEvent);
      const replay = replayLessonEvents(events);
      save("run-manifest.json", { schemaVersion: "lesson-replay-run-v1", mode: "accepted-event-replay", inputHash: bytesHash(bytes), providerCalls: 0 });
      save("state.json", replay.state);
      writeFileSync(resolve(out, "report.md"), `# Accepted-event replay\n\nProvider calls: **0**. Replayed ${events.length} events; consumed ${replay.consumedCheckpointIds.size} checkpoints.\n\nNo DOM rendering or semantic re-evaluation occurred.\n`);
    } else {
      if (!values.input) throw new Error("--input manifest.json is required");
      const mode = z.enum(["sequential", "realtime"]).parse(values.mode);
      const provider = z.enum(["mock", "configured"]).parse(values.provider);
      const split = z.enum(["original", "sentence", "phrase"]).parse(values.split) as SplitStrategy;
      const maxAttempts = z.coerce.number().int().positive().max(10000).parse(values["max-attempts"] ?? "100");
      const maxRuntimeMs = z.coerce.number().int().positive().max(3_600_000).parse(values["max-runtime-ms"] ?? "600000");
      const mockDelayMs = z.coerce.number().int().nonnegative().max(60000).parse(values["mock-delay-ms"]);
      if (provider === "configured" && (!values["allow-configured"] || !values["max-attempts"] || !values["max-runtime-ms"] || !process.env.OPENAI_API_KEY)) throw new Error("configured-provider-requires-explicit-opt-in-key-and-both-budgets");
      if (provider === "configured" && (values["mock-plan"] || values["mock-delay-ms"] !== "25")) throw new Error("mock-options-cannot-be-used-with-configured-provider");
      const input = loadInput(resolve(values.input));
      const segments = splitSegments(input.segments, split);
      const planBytes = values["mock-plan"] ? readFileSync(values["mock-plan"]) : undefined;
      const plan = z.array(z.object({ delayMs: z.number().int().nonnegative().max(60000).optional(), outcome: z.enum(["success", "provider-failure", "timeout", "invalid"]).optional() }).strict()).parse(planBytes ? JSON.parse(planBytes.toString("utf8")) : []);
      const config = requestConfiguration();
      const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
      const runManifest = { schemaVersion: "lesson-replay-run-v1", runId: randomUUID(), startedAt: new Date().toISOString(), commit: git(["rev-parse", "HEAD"]), workingTreeStatus: git(["status", "--porcelain"]),
        input: input.manifest, inputManifestHash: input.manifestHash, normalizationRulesHash: input.rulesHash,
        inputPaths: { raw: input.rawPath, normalized: input.normalizedPath }, split, splitAlgorithmVersion: "lossless-character-boundaries-v1", splitHash: bytesHash(serializeEvidence(segments)),
        timeRules: { source: "media timestamps", availability: "whole parent segment at end or later", delivery: mode === "realtime" ? "1x monotonic elapsed wall clock; independent of provider response" : "next segment only after current work settles", derivedTimestampsSynthetic: split !== "original" || input.manifest.timestampPrecision.synthetic },
        injectionBoundary: "closed-canonical-span / production checkpointFromClosedSpan", canonicalSegmentationCovered: false, microphoneAsrCovered: false, domCovered: false, noteExpiryTimerCovered: false,
        provider, mode, requestConfiguration: config, mock: provider === "mock" ? { behavior: "mechanical echo; no semantic score", defaultDelayMs: mockDelayMs, plan, planHash: planBytes ? bytesHash(planBytes) : null } : null,
        maxAttempts, maxRuntimeMs, outputPrivacy: "local; complete production audit sanitization; source files remain untouched" };
      save("run-manifest.json", runManifest);
      const timeline: TimelineRow[] = [];
      writeFileSync(resolve(out, "timeline.jsonl"), ""); writeFileSync(resolve(out, "lesson-events.jsonl"), "");
      const abort = new AbortController(); const cancel = () => abort.abort("SIGINT");
      process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
      const result = await runReplay({ lessonId: input.manifest.lessonId, segments, timelineOriginMs: input.manifest.timelineOriginMs, mode,
        interpreter: provider === "mock" ? mockInterpreter(plan, mockDelayMs) : configuredInterpreter(), model: provider === "mock" ? "mock-mechanical-echo" : config.model,
        maxAttempts, maxRuntimeMs, signal: abort.signal,
        onTimeline(row) { timeline.push(row); appendFileSync(resolve(out, "timeline.jsonl"), serializeEvidence(row) + "\n"); },
        onLessonEvents(events) { for (const event of events) appendFileSync(resolve(out, "lesson-events.jsonl"), serializeEvidence(event) + "\n"); },
      });
      process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel);
      save("result.json", { ...result, lessonEvents: undefined });
      save("run-manifest.json", { ...runManifest, completedAt: new Date().toISOString(), status: result.status });
      writeFileSync(resolve(out, "report.md"), buildReport(JSON.parse(serializeEvidence(result)), JSON.parse(serializeEvidence(timeline)), provider, mode));
      if (result.status !== "completed") process.exitCode = 2;
    }
    console.log(`Replay artifacts: ${out}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    save("failure.json", { reason });
    if (!existsSync(resolve(out, "run-manifest.json"))) save("run-manifest.json", { schemaVersion: "lesson-replay-run-v1", status: "input-or-configuration-error", input: values.input, provider: values.provider, reason });
    writeFileSync(resolve(out, "report.md"), `# Replay could not complete\n\n${serializeEvidence(reason)}\n\nAny previously written timeline/event files are preserved. No unprocessed input is counted as KEEP.\n`);
    console.error(`Replay failed; partial evidence: ${out}`); process.exitCode = 1;
  }
}
