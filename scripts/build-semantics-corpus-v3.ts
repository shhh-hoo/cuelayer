import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALPHA_AUGMENT_CANDIDATE_P4, ALPHA_CORE_P4 } from "../src/lesson-stream/semantic-profile.ts";
import { persistedAuditDigest } from "../src/trace/audit.ts";
import { teachingProviderContract } from "../server/teaching/provider-contract.ts";
import type { SemanticCorpusCaseV2, SemanticPredicate } from "../server/teaching/semantic-evaluation-v2.ts";

type SemanticCorpusCaseV3 = SemanticCorpusCaseV2 & {
  diagnosticExpectedSpeechMode: "RECONSTRUCT" | "REPRESENT";
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const v2Path = resolve(root, "resources/semantics/v2/alpha-sequences.jsonl");
const v2 = readFileSync(v2Path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as SemanticCorpusCaseV2);

const taskContent: Record<string, { texts: string[]; predicate: SemanticPredicate }> = {
  "reconstruct-ammonium-formula": {
    texts: [
      "Write ammonium as N H four with a positive charge.",
      "Write N H four plus as the ammonium formula.",
      "Record ammonium as N H four, charge plus one.",
    ],
    predicate: { entities: [["write", "record"], ["ammonium", "nh4", "n h four"]] },
  },
  "topic-shift-later-keep": {
    texts: [
      "Take a quiet moment to read that heading.",
      "Take a quiet moment to read the new heading.",
      "Read the new topic heading quietly.",
    ],
    predicate: { entities: [["read"], ["heading", "topic heading"]] },
  },
  "negative-augment-question-leakage": {
    texts: [
      "Predict which way equilibrium will move after heating; keep the direction hidden for now.",
      "Predict which side heating will favour without showing left or right.",
      "Predict where equilibrium shifts after temperature rises; do not reveal the direction.",
    ],
    predicate: { entities: [["predict"], ["equilibrium", "which side", "which way", "where"]], answerLeakage: [
      { allOf: [["shift left", "moves left", "favours left"]] },
      { allOf: [["shift right", "moves right", "favours right"]] },
    ] },
  },
};

function correctedTaskIndex(item: SemanticCorpusCaseV3) {
  if (item.scenario === "topic-shift-later-keep") return 1;
  if (item.scenario === "reconstruct-ammonium-formula" || item.scenario === "negative-augment-question-leakage") return 0;
  return -1;
}

function correctTaskTaxonomy(item: SemanticCorpusCaseV3) {
  const task = taskContent[item.scenario];
  if (!task) return;
  const surfaceIndex = item.split === "holdout" ? 0 : item.id.includes("-D1-") ? 1 : 2;
  const checkpointIndex = correctedTaskIndex(item);
  item.orderedNewCheckpoints[checkpointIndex]!.text = task.texts[surfaceIndex]!;
  item.tags = [...new Set([...item.tags.filter((tag) => tag !== "question"), "task", "teacher-originated"])] ;
  for (const gold of Object.values(item.goldByProfile)) {
    gold.expectedCueActions[checkpointIndex] = "SET";
    gold.expectedCueKinds[checkpointIndex] = "TASK";
    gold.requiredCurrentTriggerCheckpointIds = [...new Set([...gold.requiredCurrentTriggerCheckpointIds, item.orderedNewCheckpoints[checkpointIndex]!.checkpointId])];
    gold.finalState.cue = { kind: "TASK", content: task.predicate };
  }
}

const cases = v2.map((source) => {
  const item = JSON.parse(JSON.stringify(source).replaceAll("SEM2-", "SEM3-")) as SemanticCorpusCaseV3;
  item.diagnosticExpectedSpeechMode = item.tags.includes("reconstruct") ? "RECONSTRUCT" : "REPRESENT";
  for (const gold of Object.values(item.goldByProfile)) {
    const modes = new Set(gold.allowedContributionModes);
    if (modes.has("RECONSTRUCT") || modes.has("REPRESENT")) {
      modes.add("RECONSTRUCT");
      modes.add("REPRESENT");
    }
    gold.allowedContributionModes = [...modes];
  }
  correctTaskTaxonomy(item);
  return item;
});

const jsonl = `${cases.map((item) => JSON.stringify(item)).join("\n")}\n`;
const outputDir = resolve(root, "resources/semantics/v3");
mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, "alpha-sequences.jsonl"), jsonl);

const profileManifest = (profile: typeof ALPHA_CORE_P4 | typeof ALPHA_AUGMENT_CANDIDATE_P4) => {
  const contract = teachingProviderContract(profile);
  return {
    profileVersion: profile.id,
    policyVersion: profile.policyVersion,
    policyDigest: persistedAuditDigest(contract.systemPolicy),
    schemaDigest: persistedAuditDigest(contract.text.format),
  };
};
const scenarioPairs = Object.fromEntries([...new Set(cases.map((item) => item.scenario))].map((scenario) => [scenario, {
  development: cases.filter((item) => item.scenario === scenario && item.split === "development").map((item) => item.id),
  holdout: cases.filter((item) => item.scenario === scenario && item.split === "holdout").map((item) => item.id),
}]));
const categoryCounts = Object.fromEntries([...new Set(cases.flatMap((item) => item.tags))].sort().map((tag) => [tag, cases.filter((item) => item.tags.includes(tag)).length]));
const manifest = {
  corpusVersion: "alpha-semantics-corpus-v3",
  evaluatorVersion: "alpha-semantics-evaluator-v3",
  caseCount: cases.length,
  splitMembership: {
    development: cases.filter((item) => item.split === "development").map((item) => item.id),
    holdout: cases.filter((item) => item.split === "holdout").map((item) => item.id),
  },
  scenarioPairs,
  categoryCounts,
  fileSha256: createHash("sha256").update(jsonl).digest("hex"),
  core: profileManifest(ALPHA_CORE_P4),
  augment: profileManifest(ALPHA_AUGMENT_CANDIDATE_P4),
  creationTimestamp: "2026-09-05T00:00:00.000Z",
};
writeFileSync(resolve(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${cases.length} v3 cases (40 development / 20 holdout) sha256=${manifest.fileSha256}`);
