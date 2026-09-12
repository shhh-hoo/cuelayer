import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { validateScenario, profile } from "./contract.mjs";
import { sha256 } from "./evidence.mjs";
export const assetRoot = fileURLToPath(
  new URL("./scenarios/", import.meta.url),
);
export async function loadScenarios() {
  const files = (await readdir(assetRoot))
    .filter((f) => f.endsWith(".json"))
    .sort();
  return Promise.all(
    files.map(async (name) =>
      validateScenario(
        JSON.parse(await readFile(resolve(assetRoot, name), "utf8")),
      ),
    ),
  );
}
export async function loadCanaryContracts() {
  const root = fileURLToPath(new URL("./canaries/", import.meta.url));
  return Promise.all(
    (await readdir(root))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map(async (f) =>
        validateScenario(JSON.parse(await readFile(resolve(root, f), "utf8"))),
      ),
  );
}
export async function verifyLegacyInputs(scenarios, productRoot) {
  const original = JSON.parse(
    await readFile(
      resolve(productRoot, "apps/cuelayer-v2/tests/real/frontier-stories.json"),
      "utf8",
    ),
  );
  for (const c of original.cases) {
    const s = scenarios.find((s) => s.scenario_id === c.id);
    const expected = Array.from({ length: c.repeat ?? 1 }, () => c.fragments)
      .flat()
      .map((text, i) => ({ event_id: "e" + i, at_ms: i * c.intervalMs, text }));
    if (!s || sha256(s.transcript_events) !== sha256(expected))
      throw Error("legacy-input-drift:" + c.id);
  }
}
export function checkNatural(s) {
  const text = s.transcript_events.map((e) => e.text).join(" ");
  const words = text.trim().split(/\s+/).length;
  if (s.duration_ms !== 600000 || words < 1300 || words > 1500)
    throw Error("natural-load-duration-or-word-count:" + words);
  if (
    s.transcript_events.some(
      (e) =>
        e.text !== e.text.trim() ||
        /^(Fact|Correct|Review|Bind|Identify|Carry)\s*\d*:|\bEND\./.test(
          e.text,
        ),
    )
  )
    throw Error("artificial-natural-load-label-or-padding");
  for (const kind of [
    "fragmentation",
    "complete_statement",
    "cross_fragment_condition",
    "correction",
    "topic_shift",
    "return",
    "administration",
    "unfinished",
    "reference",
    "comparison",
    "cue",
    "stage_ambiguity",
  ]) {
    if (!s.coverage_requirements.some((c) => c.kind === kind))
      throw Error("natural-coverage-gap:" + kind);
  }
  return {
    words,
    duration_ms: s.duration_ms,
    events: s.transcript_events.length,
    raw_characters: text.length,
    non_whitespace_characters: text.replace(/\s/g, "").length,
  };
}
export function cohort(scenarios) {
  const short = scenarios.filter(
    (s) => s.scenario_id !== "natural-semantic-load",
  );
  return [
    ...[
      "mathematics",
      "fragmented-chemistry",
      "correction",
      "unresolved-reference",
      "stage-insufficient",
      "stage-clarified",
    ].map((id, i) => ({
      run_id: "canary-" + (i + 1),
      scenario_id: id,
      phase: "3b-1",
      dependency: "LIVE",
    })),
    ...Array.from({ length: 3 }, (_, i) =>
      short.map((s) => ({
        run_id: s.scenario_id + "-" + (i + 1),
        scenario_id: s.scenario_id,
        phase: "3b-2+3b-3",
        dependency: "LIVE",
      })),
    ).flat(),
    {
      run_id: "natural-semantic-load-1",
      scenario_id: "natural-semantic-load",
      phase: "3b-4",
      dependency: "LIVE",
    },
  ].map((r) => ({ ...r, status: "NOT_RUN" }));
}
export { profile };
