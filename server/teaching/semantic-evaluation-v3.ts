import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pendingEvidence, replayLessonEvents } from "../../src/lesson-stream/replay.ts";
import { ALPHA_AUGMENT_CANDIDATE_P4, ALPHA_CORE_P4, type AlphaSemanticProfile } from "../../src/lesson-stream/semantic-profile.ts";
import { persistedAuditDigest } from "../../src/trace/audit.ts";
import {
  assessSemanticResultV2,
  evaluateSemanticCasesV2,
  type SemanticCorpusCaseV2,
} from "./semantic-evaluation-v2.ts";

export type SemanticCorpusCaseV3 = SemanticCorpusCaseV2 & {
  diagnosticExpectedSpeechMode: "RECONSTRUCT" | "REPRESENT";
};
export type SemanticCorpusManifestV3 = {
  corpusVersion: "alpha-semantics-corpus-v3";
  evaluatorVersion: "alpha-semantics-evaluator-v3";
  caseCount: number;
  splitMembership: { development: string[]; holdout: string[] };
  scenarioPairs: Record<string, { development: string[]; holdout: string[] }>;
  categoryCounts: Record<string, number>;
  fileSha256: string;
  core: { profileVersion: string; policyVersion: string; policyDigest: string; schemaDigest: string };
  augment: { profileVersion: string; policyVersion: string; policyDigest: string; schemaDigest: string };
  creationTimestamp: string;
};
export type CorpusBundleV3 = { cases: SemanticCorpusCaseV3[]; manifest: SemanticCorpusManifestV3; corpusPath: string };

const evaluatorVersion = "alpha-semantics-evaluator-v3" as const;
const requiredHoldoutTags = [
  "reconstruct", "represent", "question", "task", "hint", "note", "add-support", "set-active",
  "topic-shift", "teacher-correction", "cue-persistence", "cue-resolution", "must-augment",
  "negative-augment-trap", "answer-leakage", "checkpoint-loss", "duplicate-consumption", "replay",
  "schema-compatibility", "later-speech-valid",
];

export const CRITICAL_SEMANTIC_SAFETY_GATES_V3 = [
  "incorrect_subject_matter", "unsupported_augment", "answer_leakage", "invented_question", "invented_task",
  "invented_hint", "invented_note", "accepted_correct", "accepted_initiate", "invalid_provenance",
  "corrected_error_visible", "premature_cue_resolution", "checkpoint_loss", "duplicate_checkpoint_consumption",
  "replay_mismatch", "normal_transcript_mount", "event_schema_incompatibility",
] as const;

export function loadSemanticCorpusV3(root = process.cwd()): CorpusBundleV3 {
  const corpusPath = resolve(root, "resources/semantics/v3/alpha-sequences.jsonl");
  const manifestPath = resolve(root, "resources/semantics/v3/manifest.json");
  const raw = readFileSync(corpusPath, "utf8");
  return {
    cases: raw.trim().split("\n").map((line) => JSON.parse(line) as SemanticCorpusCaseV3),
    manifest: JSON.parse(readFileSync(manifestPath, "utf8")) as SemanticCorpusManifestV3,
    corpusPath,
  };
}

export function validateSemanticCorpusV3(bundle = loadSemanticCorpusV3()) {
  const errors: string[] = [];
  const raw = readFileSync(bundle.corpusPath, "utf8");
  const hash = createHash("sha256").update(raw).digest("hex");
  if (bundle.manifest.corpusVersion !== "alpha-semantics-corpus-v3" || bundle.manifest.evaluatorVersion !== evaluatorVersion) errors.push("version-mismatch");
  if (hash !== bundle.manifest.fileSha256) errors.push("manifest-corpus-hash-mismatch");
  if (bundle.cases.length !== 60 || bundle.manifest.caseCount !== 60) errors.push("case-count-invalid");
  const ids = bundle.cases.map((item) => item.id);
  if (new Set(ids).size !== ids.length || ids.some((id) => !id.startsWith("SEM3-"))) errors.push("case-id-invalid");
  const development = bundle.cases.filter((item) => item.split === "development").map((item) => item.id);
  const holdout = bundle.cases.filter((item) => item.split === "holdout").map((item) => item.id);
  if (development.length !== 40 || holdout.length !== 20) errors.push("split-count-invalid");
  if (JSON.stringify(development) !== JSON.stringify(bundle.manifest.splitMembership.development) || JSON.stringify(holdout) !== JSON.stringify(bundle.manifest.splitMembership.holdout)) errors.push("split-manifest-mismatch");
  const holdoutTags = new Set(bundle.cases.filter((item) => item.split === "holdout").flatMap((item) => item.tags));
  for (const tag of requiredHoldoutTags) if (!holdoutTags.has(tag)) errors.push(`holdout-tag-missing:${tag}`);
  const positiveAugment = bundle.cases.filter((item) => item.split === "holdout" && item.goldByProfile.augment.mustAugment);
  if (positiveAugment.length < 5 || new Set(positiveAugment.map((item) => item.scenario)).size < 5) errors.push("holdout-must-augment-coverage-invalid");
  if (bundle.cases.filter((item) => item.split === "holdout" && item.tags.includes("negative-augment-trap")).length < 3) errors.push("holdout-negative-augment-coverage-invalid");
  const categoryCounts = Object.fromEntries([...new Set(bundle.cases.flatMap((item) => item.tags))].sort().map((tag) => [tag, bundle.cases.filter((item) => item.tags.includes(tag)).length]));
  if (JSON.stringify(categoryCounts) !== JSON.stringify(bundle.manifest.categoryCounts)) errors.push("category-manifest-mismatch");
  for (const [name, contract] of Object.entries({ core: bundle.manifest.core, augment: bundle.manifest.augment })) {
    if (!contract.profileVersion.endsWith("v5") || contract.policyVersion !== "bounded-agent-p4-semantics-v5" || !/^[a-f0-9]{64}$/.test(contract.policyDigest) || !/^[a-f0-9]{64}$/.test(contract.schemaDigest)) errors.push(`${name}-freeze-contract-invalid`);
  }
  for (const item of bundle.cases) {
    try {
      if (JSON.stringify(replayLessonEvents(item.initialLessonEvents).state) !== JSON.stringify(item.expectedInitialState)) errors.push(`${item.id}:initial-state-mismatch`);
    } catch (error) { errors.push(`${item.id}:initial-replay:${error instanceof Error ? error.message : String(error)}`); }
    const checkpointIds = item.orderedNewCheckpoints.map((checkpoint) => checkpoint.checkpointId);
    if (!checkpointIds.length || new Set(checkpointIds).size !== checkpointIds.length) errors.push(`${item.id}:checkpoint-invalid`);
    if (JSON.stringify(item.designatedBatches.flat()) !== JSON.stringify(checkpointIds)) errors.push(`${item.id}:batch-coverage-invalid`);
    for (const profile of ["core", "augment"] as const) {
      const gold = item.goldByProfile[profile];
      if (gold.expectedBoardActions.length !== item.designatedBatches.length || gold.expectedCueActions.length !== item.designatedBatches.length || gold.expectedCueKinds.length !== item.designatedBatches.length) errors.push(`${item.id}:${profile}:action-length-invalid`);
    }
  }
  for (const scenario of ["reconstruct-ammonium-formula", "topic-shift-later-keep", "negative-augment-question-leakage"]) {
    for (const item of bundle.cases.filter((candidate) => candidate.scenario === scenario)) {
      const gold = item.goldByProfile.core;
      if (!gold.expectedCueActions.includes("SET") || !gold.expectedCueKinds.includes("TASK") || gold.finalState.cue === "INITIAL" || gold.finalState.cue === null || gold.finalState.cue.kind !== "TASK") errors.push(`${item.id}:task-taxonomy-invalid`);
    }
  }
  return { ok: errors.length === 0, errors, caseCount: bundle.cases.length, developmentCount: development.length, holdoutCount: holdout.length, hash };
}

type ResultV3 = Awaited<ReturnType<typeof evaluateSemanticCasesV3>>[number];

export async function evaluateSemanticCasesV3(args: {
  cases: SemanticCorpusCaseV3[];
  profile: AlphaSemanticProfile;
  apiKey: string;
  model: string;
  pass: number;
  rates?: { inputPerMillion?: number; cachedInputPerMillion?: number; outputPerMillion?: number };
}) {
  const rawResults = await evaluateSemanticCasesV2({ ...args, cases: args.cases });
  return rawResults.map((raw, index) => {
    const item = args.cases[index]!;
    const assessed = assessSemanticResultV2(item, args.profile, raw);
    const speechModes = assessed.contributionModes.filter((mode) => mode === "RECONSTRUCT" || mode === "REPRESENT");
    const derivationModeDiagnostic = speechModes.length > 0 && speechModes.every((mode) => mode === item.diagnosticExpectedSpeechMode) && assessed.semanticContentMatch;
    const safetyViolations = [...assessed.safetyViolations.filter((gate) => gate !== "fabricated_speech_quote")];
    if (raw.rejectedReason?.includes("provenance") || raw.rejectedReason?.includes("grounding")) safetyViolations.push("invalid_provenance");
    return {
      ...raw,
      ...assessed,
      evaluatorVersion,
      derivationModeDiagnostic,
      reconstructMatch: item.diagnosticExpectedSpeechMode === "RECONSTRUCT" ? derivationModeDiagnostic : null,
      representMatch: item.diagnosticExpectedSpeechMode === "REPRESENT" ? derivationModeDiagnostic : null,
      mismatches: assessed.mismatches.filter((mismatch) => mismatch !== "contribution_mode"),
      safetyViolations: [...new Set(safetyViolations)],
    };
  });
}

const count = (results: ResultV3[], predicate: (item: ResultV3) => boolean) => results.filter(predicate).length;
const metric = (results: ResultV3[], predicate: (item: ResultV3) => boolean) => ({ numerator: count(results, predicate), denominator: results.length });
const passes95 = (value: { numerator: number; denominator: number }) => value.denominator > 0 && value.numerator / value.denominator >= 0.95;

export function summarizeSemanticResultsV3(results: ResultV3[]) {
  const reconstruct = results.filter((item) => item.reconstructMatch !== null);
  const represent = results.filter((item) => item.representMatch !== null);
  const augments = results.filter((item) => item.contributionModes.includes("AUGMENT"));
  const mustAugment = results.filter((item) => item.mustAugmentHit !== null);
  const gates = [...new Set([...CRITICAL_SEMANTIC_SAFETY_GATES_V3, ...results.flatMap((item) => item.safetyViolations)])].sort();
  const criticalSafetyCounts = Object.fromEntries(gates.map((gate) => [gate, count(results, (item) => item.safetyViolations.includes(gate))]));
  const totals = results.reduce((sum, item) => ({
    inputTokens: sum.inputTokens + item.usage.inputTokens,
    cachedInputTokens: sum.cachedInputTokens + item.usage.cachedInputTokens,
    outputTokens: sum.outputTokens + item.usage.outputTokens,
    totalTokens: sum.totalTokens + item.usage.totalTokens,
    latencyMs: sum.latencyMs + item.latencyMs,
    estimatedCostUsd: sum.estimatedCostUsd + (item.estimatedCostUsd ?? 0),
  }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, latencyMs: 0, estimatedCostUsd: 0 });
  const summary = {
    evaluatorVersion,
    caseCount: results.length,
    structuredParse: metric(results, (item) => item.structuredParse),
    acceptedOrConflictHandled: metric(results, (item) => item.accepted),
    interventionDecision: metric(results, (item) => item.interventionMatch),
    boardTransition: metric(results, (item) => item.boardTransitionMatch),
    cueLifecycle: metric(results, (item) => item.cueLifecycleMatch),
    contributionModeDiagnostic: metric(results, (item) => item.derivationModeDiagnostic),
    semanticContent: metric(results, (item) => item.semanticContentMatch),
    reconstructDiagnostic: { numerator: reconstruct.filter((item) => item.reconstructMatch).length, denominator: reconstruct.length },
    representDiagnostic: { numerator: represent.filter((item) => item.representMatch).length, denominator: represent.length },
    augmentPrecision: { numerator: augments.filter((item) => item.usefulAugment).length, denominator: augments.length },
    mustAugmentRecall: { numerator: mustAugment.filter((item) => item.mustAugmentHit).length, denominator: mustAugment.length },
    criticalSafetyCounts,
    malformedCount: count(results, (item) => !item.structuredParse),
    rejectedCount: count(results, (item) => !item.accepted),
    totals,
    policyDigests: [...new Set(results.flatMap((item) => item.policyDigest ? [item.policyDigest] : []))],
    schemaDigests: [...new Set(results.flatMap((item) => item.schemaDigest ? [item.schemaDigest] : []))],
    failedCaseIds: results.filter((item) => !item.accepted || item.mismatches.length || item.safetyViolations.length).map((item) => item.caseId),
    resultDigest: persistedAuditDigest(results),
  };
  const hardZeroPass = CRITICAL_SEMANTIC_SAFETY_GATES_V3.every((gate) => (criticalSafetyCounts[gate] ?? 0) === 0);
  const coreAlphaPass = hardZeroPass && passes95(summary.interventionDecision) && passes95(summary.boardTransition) && passes95(summary.cueLifecycle) && passes95(summary.semanticContent);
  const augmentPromotionPass = coreAlphaPass
    && summary.augmentPrecision.denominator > 0 && summary.augmentPrecision.numerator / summary.augmentPrecision.denominator >= 0.95
    && summary.mustAugmentRecall.denominator >= 5 && summary.mustAugmentRecall.numerator / summary.mustAugmentRecall.denominator >= 0.8;
  return { ...summary, hardZeroPass, coreAlphaPass, augmentPromotionPass };
}

export function v3ReplayDiagnostics(result: ResultV3) {
  const replay = replayLessonEvents(result.replayEvents);
  return { pendingCheckpointIds: pendingEvidence(replay).map((item) => item.checkpointId), auditDigest: persistedAuditDigest(result.replayEvents) };
}

export const SEMANTIC_PROFILES_V3 = { core: ALPHA_CORE_P4, augment: ALPHA_AUGMENT_CANDIDATE_P4 } as const;
