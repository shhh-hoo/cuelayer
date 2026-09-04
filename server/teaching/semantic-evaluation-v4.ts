import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { replayLessonEvents } from "../../src/lesson-stream/replay.ts";
import { ALPHA_AUGMENT_CANDIDATE_P4, ALPHA_CORE_P4, type AlphaSemanticProfile } from "../../src/lesson-stream/semantic-profile.ts";
import { evaluateSemanticCasesV3, summarizeSemanticResultsV3, type SemanticCorpusCaseV3 } from "./semantic-evaluation-v3.ts";

export type SemanticCorpusManifestV4 = {
  corpusVersion: "alpha-semantics-corpus-v4";
  evaluatorVersion: "alpha-semantics-evaluator-v4";
  caseCount: number;
  splitMembership: { development: string[]; holdout: string[] };
  scenarioPairs: Record<string, { development: string[]; holdout: string[] }>;
  categoryCounts: Record<string, number>;
  fileSha256: string;
  core: { profileVersion: string; policyVersion: string; policyDigest: string; schemaDigest: string };
  augment: { profileVersion: string; policyVersion: string; policyDigest: string; schemaDigest: string };
  creationTimestamp: string;
};
export type CorpusBundleV4 = { cases: SemanticCorpusCaseV3[]; manifest: SemanticCorpusManifestV4; corpusPath: string };
const evaluatorVersion = "alpha-semantics-evaluator-v4" as const;

export function loadSemanticCorpusV4(root = process.cwd()): CorpusBundleV4 {
  const corpusPath = resolve(root, "resources/semantics/v4/alpha-sequences.jsonl");
  const manifestPath = resolve(root, "resources/semantics/v4/manifest.json");
  const raw = readFileSync(corpusPath, "utf8");
  return { cases: raw.trim().split("\n").map((line) => JSON.parse(line) as SemanticCorpusCaseV3), manifest: JSON.parse(readFileSync(manifestPath, "utf8")) as SemanticCorpusManifestV4, corpusPath };
}

export function validateSemanticCorpusV4(bundle = loadSemanticCorpusV4()) {
  const errors: string[] = [];
  const raw = readFileSync(bundle.corpusPath, "utf8");
  const hash = createHash("sha256").update(raw).digest("hex");
  if (bundle.manifest.corpusVersion !== "alpha-semantics-corpus-v4" || bundle.manifest.evaluatorVersion !== evaluatorVersion) errors.push("version-mismatch");
  if (hash !== bundle.manifest.fileSha256) errors.push("manifest-corpus-hash-mismatch");
  const development = bundle.cases.filter((item) => item.split === "development").map((item) => item.id);
  const holdout = bundle.cases.filter((item) => item.split === "holdout").map((item) => item.id);
  if (bundle.cases.length !== 60 || development.length !== 40 || holdout.length !== 20) errors.push("split-count-invalid");
  if (new Set(bundle.cases.map((item) => item.id)).size !== 60 || bundle.cases.some((item) => !item.id.startsWith("SEM4-"))) errors.push("case-id-invalid");
  if (JSON.stringify(development) !== JSON.stringify(bundle.manifest.splitMembership.development) || JSON.stringify(holdout) !== JSON.stringify(bundle.manifest.splitMembership.holdout)) errors.push("split-manifest-mismatch");
  if (bundle.cases.filter((item) => item.split === "holdout" && item.goldByProfile.augment.mustAugment).length !== 5) errors.push("holdout-must-augment-coverage-invalid");
  if (bundle.cases.filter((item) => item.split === "holdout" && item.tags.includes("negative-augment-trap")).length !== 3) errors.push("holdout-negative-augment-coverage-invalid");
  for (const [name, contract] of Object.entries({ core: bundle.manifest.core, augment: bundle.manifest.augment })) {
    if (!contract.profileVersion.endsWith("v6") || contract.policyVersion !== "bounded-agent-p4-semantics-v6" || !/^[a-f0-9]{64}$/.test(contract.policyDigest) || !/^[a-f0-9]{64}$/.test(contract.schemaDigest)) errors.push(`${name}-freeze-contract-invalid`);
  }
  for (const item of bundle.cases) {
    try { if (JSON.stringify(replayLessonEvents(item.initialLessonEvents).state) !== JSON.stringify(item.expectedInitialState)) errors.push(`${item.id}:initial-state-mismatch`); }
    catch (error) { errors.push(`${item.id}:initial-replay:${error instanceof Error ? error.message : String(error)}`); }
    const checkpointIds = item.orderedNewCheckpoints.map((checkpoint) => checkpoint.checkpointId);
    if (JSON.stringify(item.designatedBatches.flat()) !== JSON.stringify(checkpointIds)) errors.push(`${item.id}:batch-coverage-invalid`);
    for (const profile of ["core", "augment"] as const) {
      const gold = item.goldByProfile[profile];
      if (gold.expectedBoardActions.length !== item.designatedBatches.length || gold.expectedCueActions.length !== item.designatedBatches.length || gold.expectedCueKinds.length !== item.designatedBatches.length) errors.push(`${item.id}:${profile}:action-length-invalid`);
    }
  }
  for (const scenario of ["reconstruct-ammonium-formula", "topic-shift-later-keep", "negative-augment-question-leakage"]) {
    for (const item of bundle.cases.filter((candidate) => candidate.scenario === scenario)) {
      if (!item.goldByProfile.core.expectedCueKinds.includes("TASK")) errors.push(`${item.id}:task-taxonomy-invalid`);
    }
  }
  return { ok: errors.length === 0, errors, caseCount: bundle.cases.length, developmentCount: development.length, holdoutCount: holdout.length, hash };
}

export async function evaluateSemanticCasesV4(args: { cases: SemanticCorpusCaseV3[]; profile: AlphaSemanticProfile; apiKey: string; model: string; pass: number; rates?: { inputPerMillion?: number; cachedInputPerMillion?: number; outputPerMillion?: number } }) {
  const results = await evaluateSemanticCasesV3(args);
  return results.map((result) => ({ ...result, evaluatorVersion }));
}

export function summarizeSemanticResultsV4(results: Awaited<ReturnType<typeof evaluateSemanticCasesV4>>) {
  return { ...summarizeSemanticResultsV3(results as never), evaluatorVersion };
}

export const SEMANTIC_PROFILES_V4 = { core: ALPHA_CORE_P4, augment: ALPHA_AUGMENT_CANDIDATE_P4 } as const;
