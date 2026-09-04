import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { replayLessonEvents } from "../../src/lesson-stream/replay.ts";
import { ALPHA_AUGMENT_CANDIDATE_P4, ALPHA_CORE_P4, type AlphaSemanticProfile } from "../../src/lesson-stream/semantic-profile.ts";
import { evaluateSemanticCasesV4, summarizeSemanticResultsV4 } from "./semantic-evaluation-v4.ts";
import type { SemanticCorpusCaseV3 } from "./semantic-evaluation-v3.ts";

export type SemanticCorpusManifestV5 = {
  corpusVersion: "alpha-semantics-corpus-v5"; evaluatorVersion: "alpha-semantics-evaluator-v5"; caseCount: number;
  splitMembership: { development: string[]; holdout: string[] }; scenarioPairs: Record<string, { development: string[]; holdout: string[] }>;
  categoryCounts: Record<string, number>; fileSha256: string;
  core: { profileVersion: string; policyVersion: string; policyDigest: string; schemaDigest: string };
  augment: { profileVersion: string; policyVersion: string; policyDigest: string; schemaDigest: string }; creationTimestamp: string;
};
export type CorpusBundleV5 = { cases: SemanticCorpusCaseV3[]; manifest: SemanticCorpusManifestV5; corpusPath: string };
const evaluatorVersion = "alpha-semantics-evaluator-v5" as const;

export function loadSemanticCorpusV5(root = process.cwd()): CorpusBundleV5 {
  const corpusPath = resolve(root, "resources/semantics/v5/alpha-sequences.jsonl");
  const raw = readFileSync(corpusPath, "utf8");
  return { cases: raw.trim().split("\n").map((line) => JSON.parse(line) as SemanticCorpusCaseV3), manifest: JSON.parse(readFileSync(resolve(root, "resources/semantics/v5/manifest.json"), "utf8")) as SemanticCorpusManifestV5, corpusPath };
}

export function validateSemanticCorpusV5(bundle = loadSemanticCorpusV5()) {
  const errors: string[] = []; const raw = readFileSync(bundle.corpusPath, "utf8"); const hash = createHash("sha256").update(raw).digest("hex");
  const development = bundle.cases.filter((item) => item.split === "development").map((item) => item.id); const holdout = bundle.cases.filter((item) => item.split === "holdout").map((item) => item.id);
  if (bundle.manifest.corpusVersion !== "alpha-semantics-corpus-v5" || bundle.manifest.evaluatorVersion !== evaluatorVersion) errors.push("version-mismatch");
  if (hash !== bundle.manifest.fileSha256) errors.push("manifest-corpus-hash-mismatch");
  if (bundle.cases.length !== 60 || development.length !== 40 || holdout.length !== 20) errors.push("split-count-invalid");
  if (new Set(bundle.cases.map((item) => item.id)).size !== 60 || bundle.cases.some((item) => !item.id.startsWith("SEM5-"))) errors.push("case-id-invalid");
  if (JSON.stringify(development) !== JSON.stringify(bundle.manifest.splitMembership.development) || JSON.stringify(holdout) !== JSON.stringify(bundle.manifest.splitMembership.holdout)) errors.push("split-manifest-mismatch");
  if (bundle.cases.filter((item) => item.split === "holdout" && item.goldByProfile.augment.mustAugment).length !== 5) errors.push("holdout-must-augment-coverage-invalid");
  if (bundle.cases.filter((item) => item.split === "holdout" && item.tags.includes("negative-augment-trap")).length !== 3) errors.push("holdout-negative-augment-coverage-invalid");
  for (const [name, contract] of Object.entries({ core: bundle.manifest.core, augment: bundle.manifest.augment })) if (!contract.profileVersion.endsWith("v7") || contract.policyVersion !== "bounded-agent-p4-semantics-v7" || !/^[a-f0-9]{64}$/.test(contract.policyDigest) || !/^[a-f0-9]{64}$/.test(contract.schemaDigest)) errors.push(`${name}-freeze-contract-invalid`);
  for (const item of bundle.cases) {
    try { if (JSON.stringify(replayLessonEvents(item.initialLessonEvents).state) !== JSON.stringify(item.expectedInitialState)) errors.push(`${item.id}:initial-state-mismatch`); } catch (error) { errors.push(`${item.id}:initial-replay:${error instanceof Error ? error.message : String(error)}`); }
    const ids = item.orderedNewCheckpoints.map((checkpoint) => checkpoint.checkpointId); if (JSON.stringify(item.designatedBatches.flat()) !== JSON.stringify(ids)) errors.push(`${item.id}:batch-coverage-invalid`);
    for (const profile of ["core", "augment"] as const) { const gold = item.goldByProfile[profile]; if (gold.expectedBoardActions.length !== item.designatedBatches.length || gold.expectedCueActions.length !== item.designatedBatches.length || gold.expectedCueKinds.length !== item.designatedBatches.length) errors.push(`${item.id}:${profile}:action-length-invalid`); }
  }
  for (const scenario of ["reconstruct-ammonium-formula", "topic-shift-later-keep", "negative-augment-question-leakage"]) for (const item of bundle.cases.filter((candidate) => candidate.scenario === scenario)) if (!item.goldByProfile.core.expectedCueKinds.includes("TASK")) errors.push(`${item.id}:task-taxonomy-invalid`);
  return { ok: errors.length === 0, errors, caseCount: bundle.cases.length, developmentCount: development.length, holdoutCount: holdout.length, hash };
}

export async function evaluateSemanticCasesV5(args: { cases: SemanticCorpusCaseV3[]; profile: AlphaSemanticProfile; apiKey: string; model: string; pass: number; rates?: { inputPerMillion?: number; cachedInputPerMillion?: number; outputPerMillion?: number } }) {
  const results = await evaluateSemanticCasesV4(args);
  return results.map((result) => {
    const flexibleNoteBoard = result.scenario === "note-with-active" && result.accepted && result.interventionMatch && result.cueLifecycleMatch && result.semanticContentMatch && result.resultingState.board.retained.length === 0;
    const boardTransitionMatch = flexibleNoteBoard || result.boardTransitionMatch;
    return { ...result, evaluatorVersion, boardTransitionMatch, mismatches: boardTransitionMatch ? result.mismatches.filter((item) => item !== "board_transition") : result.mismatches };
  });
}

export function summarizeSemanticResultsV5(results: Awaited<ReturnType<typeof evaluateSemanticCasesV5>>) { return { ...summarizeSemanticResultsV4(results as never), evaluatorVersion }; }
export const SEMANTIC_PROFILES_V5 = { core: ALPHA_CORE_P4, augment: ALPHA_AUGMENT_CANDIDATE_P4 } as const;
