import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BoardContent, CompactEvidenceCheckpoint, LessonEvent, TeachingStateSnapshot } from "../../src/lesson-stream/contracts.ts";
import { buildTeachingInterpretationRequest } from "../../src/lesson-stream/context-projection.ts";
import { replayLessonEvents } from "../../src/lesson-stream/replay.ts";
import { LessonStreamRuntime, type LessonEventStore } from "../../src/lesson-stream/runtime.ts";
import { ALPHA_AUGMENT_CANDIDATE_P4, ALPHA_CORE_P4, type AlphaSemanticProfile } from "../../src/lesson-stream/semantic-profile.ts";
import { persistedAuditDigest } from "../../src/trace/audit.ts";
import { estimateTeachingCost, requestOpenAITeachingInterpretation } from "./openai-interpreter.ts";
import { teachingProviderContract } from "./provider-contract.ts";

export type SemanticCorpusCase = {
  id: string;
  split: "development" | "holdout";
  tags: string[];
  risk: "low" | "medium" | "critical";
  initialLessonEvents: LessonEvent[];
  expectedInitialState: { boardActiveText: string | null; cueKind: string | null };
  orderedNewCheckpoints: CompactEvidenceCheckpoint[];
  designatedBatches: string[][];
  gold: {
    expectedBoardActions: Array<"KEEP" | "SET_ACTIVE" | "ADD_SUPPORT">;
    expectedCueActions: Array<"KEEP" | "SET" | "RESOLVE_CURRENT">;
    allowedContributionModes: string[];
    requiredCurrentTriggerCheckpointIds: string[];
    expectedContinuity: "same_thread" | "topic_shift" | "correction" | null;
    expectedInvalidations: string[];
    expectedFinalState: { boardActive: "changed" | "preserved"; cue: "active" | "resolved" | "preserved" | "none" };
    requiredNormalizedFragments: string[];
    allowedCanonicalVariants: string[];
    forbiddenNormalizedFragments: string[];
    requiredRelation: "cause" | "sequence" | "contrast" | null;
    forbiddenRelation: string | null;
    requiredSymbols: string[];
    requiredConditions: string[];
    forbiddenAnswerMaterial: string[];
    mustAugment: boolean;
    safetyAssertions: string[];
    rationale: string;
  };
};

export type SemanticCorpusManifest = {
  corpusVersion: string;
  caseCount: number;
  splitMembership: { development: string[]; holdout: string[] };
  categoryCounts: Record<string, number>;
  fileSha256: string;
  policyVersion: string;
  profileVersion: string;
  policyDigest: string;
  schemaDigest: string;
  creationTimestamp: string;
};

export type CorpusBundle = { cases: SemanticCorpusCase[]; manifest: SemanticCorpusManifest; corpusPath: string };

const requiredHoldoutRisks = [
  "autonomous-correct", "autonomous-initiate", "cue-augment", "domain-only-cue", "fabricated-quote",
  "invented-question", "invented-task", "invented-hint", "invented-note", "answer-leakage",
  "teacher-correction", "premature-resolution", "history-reactivation", "checkpoint-loss",
  "duplicate-consumption", "replay", "schema-compatibility", "no-transcript", "unsupported-proposition", "augment",
];

export function normalizeSemanticText(value: string) {
  return value.toLowerCase()
    .replace(/[₀-₉]/g, (digit) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(digit)))
    .replace(/[⁰-⁹]/g, (digit) => String("⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(digit)))
    .replace(/[ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ]/g, (letter) => ({ "ₐ": "a", "ₑ": "e", "ₕ": "h", "ᵢ": "i", "ⱼ": "j", "ₖ": "k", "ₗ": "l", "ₘ": "m", "ₙ": "n", "ₒ": "o", "ₚ": "p", "ᵣ": "r", "ₛ": "s", "ₜ": "t", "ᵤ": "u", "ᵥ": "v", "ₓ": "x" }[letter] ?? letter))
    .replace(/[⁺+]/g, "+").replace(/[⁻−-]/g, "-")
    .replace(/[⇌↔]/g, " equilibrium-arrow ").replace(/[→⟶]/g, " forward-arrow ")
    .replace(/[^a-z0-9+\-≥≤]+/g, " ").replace(/\s+/g, " ").trim();
}

export function loadSemanticCorpus(root = process.cwd()): CorpusBundle {
  const corpusPath = resolve(root, "resources/semantics/alpha-sequences.jsonl");
  const manifestPath = resolve(root, "resources/semantics/manifest.json");
  const raw = readFileSync(corpusPath, "utf8");
  const cases = raw.trim().split("\n").map((line) => JSON.parse(line) as SemanticCorpusCase);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SemanticCorpusManifest;
  return { cases, manifest, corpusPath };
}

function boardText(content: BoardContent) {
  if (content.kind === "TEXT") return content.text;
  if (content.kind === "FOCUS") return content.target;
  if (content.kind === "RELATION") return `${content.relation} ${content.targets.join(" ")}`;
  return `${content.from} ${content.to}`;
}

export function visibleStateText(state: TeachingStateSnapshot) {
  const values = [
    ...(state.board.active ? [boardText(state.board.active.contribution.content)] : []),
    ...state.board.support.map((item) => item.contribution.content),
    ...state.board.retained.map((item) => boardText(item.contribution.content)),
    ...(state.cue.active ? [state.cue.active.contribution.content] : []),
  ];
  return normalizeSemanticText(values.join(" "));
}

export function validateSemanticCorpus(bundle = loadSemanticCorpus()) {
  const errors: string[] = [];
  const raw = readFileSync(bundle.corpusPath, "utf8");
  const hash = createHash("sha256").update(raw).digest("hex");
  if (hash !== bundle.manifest.fileSha256) errors.push("manifest-corpus-hash-mismatch");
  const activeContract = teachingProviderContract(ALPHA_CORE_P4);
  if (bundle.manifest.policyVersion !== ALPHA_CORE_P4.policyVersion || bundle.manifest.profileVersion !== ALPHA_CORE_P4.id) errors.push("manifest-policy-profile-mismatch");
  if (bundle.manifest.policyDigest !== persistedAuditDigest(activeContract.systemPolicy) || bundle.manifest.schemaDigest !== persistedAuditDigest(activeContract.text.format)) errors.push("manifest-policy-schema-digest-mismatch");
  if (bundle.cases.length !== bundle.manifest.caseCount || bundle.cases.length < 60) errors.push("case-count-invalid");
  const ids = bundle.cases.map((item) => item.id);
  if (new Set(ids).size !== ids.length) errors.push("duplicate-case-id");
  const development = bundle.cases.filter((item) => item.split === "development").map((item) => item.id);
  const holdout = bundle.cases.filter((item) => item.split === "holdout").map((item) => item.id);
  if (development.length !== 40 || holdout.length !== 20) errors.push("split-count-invalid");
  if (JSON.stringify(development) !== JSON.stringify(bundle.manifest.splitMembership.development) || JSON.stringify(holdout) !== JSON.stringify(bundle.manifest.splitMembership.holdout)) errors.push("split-manifest-mismatch");
  const holdoutTags = new Set(bundle.cases.filter((item) => item.split === "holdout").flatMap((item) => item.tags));
  for (const tag of requiredHoldoutRisks) if (!holdoutTags.has(tag)) errors.push(`holdout-risk-missing:${tag}`);
  const categoryCounts = Object.fromEntries([...new Set(bundle.cases.flatMap((item) => item.tags))].sort().map((tag) => [tag, bundle.cases.filter((item) => item.tags.includes(tag)).length]));
  if (JSON.stringify(categoryCounts) !== JSON.stringify(bundle.manifest.categoryCounts)) errors.push("category-manifest-mismatch");

  for (const item of bundle.cases) {
    try {
      const replay = replayLessonEvents(item.initialLessonEvents);
      const initialText = replay.state.board.active ? boardText(replay.state.board.active.contribution.content) : null;
      if (initialText !== item.expectedInitialState.boardActiveText || (replay.state.cue.active?.kind ?? null) !== item.expectedInitialState.cueKind) errors.push(`${item.id}:initial-state-mismatch`);
    } catch (error) { errors.push(`${item.id}:initial-replay:${error instanceof Error ? error.message : String(error)}`); }
    if (!item.orderedNewCheckpoints.length || !item.designatedBatches.length) errors.push(`${item.id}:missing-new-evidence`);
    const checkpointIds = item.orderedNewCheckpoints.map((checkpoint) => checkpoint.checkpointId);
    if (new Set(checkpointIds).size !== checkpointIds.length) errors.push(`${item.id}:duplicate-checkpoint-id`);
    const designated = item.designatedBatches.flat();
    if (JSON.stringify(designated) !== JSON.stringify(checkpointIds)) errors.push(`${item.id}:batch-coverage-invalid`);
    if (!item.gold.rationale || !item.gold.safetyAssertions.length) errors.push(`${item.id}:gold-incomplete`);
    if (!item.gold.safetyAssertions.includes("current_trigger_required") || !item.gold.safetyAssertions.includes("replay_equal")) errors.push(`${item.id}:critical-assertions-missing`);
  }
  return { ok: errors.length === 0, errors, caseCount: bundle.cases.length, developmentCount: development.length, holdoutCount: holdout.length, hash };
}

type CaseResult = {
  caseId: string; split: string; tags: string[]; profileId: string; policyVersion: string; policyDigest?: string; schemaDigest?: string;
  provider: "openai"; requestedModel: string; actualModel?: string; requestIds: string[]; structuredParse: boolean; accepted: boolean; rejectedReason?: string;
  proposedSteps: unknown[]; normalizedSteps: unknown[]; boardActions: string[]; cueActions: string[]; contributionModes: string[]; provenanceBases: string[];
  consumedCheckpointIds: string[]; resultingState: TeachingStateSnapshot; replayEqual: boolean; currentTriggerPass: boolean;
  interventionMatch: boolean; boardTransitionMatch: boolean; cueLifecycleMatch: boolean; contributionModeMatch: boolean; semanticContentMatch: boolean;
  reconstructMatch: boolean | null; representMatch: boolean | null; usefulAugment: boolean | null; mustAugmentHit: boolean | null;
  mismatches: string[]; safetyViolations: string[]; warnings: unknown[]; usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number; totalTokens: number }; latencyMs: number; estimatedCostUsd?: number;
};

class MemoryStore implements LessonEventStore {
  readonly rows: LessonEvent[];
  constructor(rows: LessonEvent[]) { this.rows = rows; }
  async append(events: readonly LessonEvent[]) { this.rows.push(...events); }
  async readSession(sessionId: string) { return this.rows.filter((event) => event.sessionId === sessionId); }
}

function contributionsFromSteps(steps: Array<{ boardDelta: any; cueDelta: any }>) {
  return steps.flatMap((step) => [
    ...(step.boardDelta.action === "SET_ACTIVE" ? [step.boardDelta.contribution, ...(step.boardDelta.support ?? [])] : step.boardDelta.action === "ADD_SUPPORT" ? [step.boardDelta.support] : []),
    ...(step.cueDelta.action === "SET" ? [step.cueDelta.contribution] : []),
  ]);
}

function semanticAssessment(item: SemanticCorpusCase, profile: AlphaSemanticProfile, steps: any[], state: TeachingStateSnapshot, replayEqual: boolean, consumed: string[]) {
  const coreSuppressesAugment = profile.id === ALPHA_CORE_P4.id && item.gold.allowedContributionModes.includes("AUGMENT");
  const expectedBoard = coreSuppressesAugment ? item.gold.expectedBoardActions.map(() => "KEEP") : item.gold.expectedBoardActions;
  const expectedCue = item.gold.expectedCueActions;
  const required = coreSuppressesAugment ? [] : item.gold.requiredNormalizedFragments;
  const boardActions = steps.map((step) => step.boardDelta.action);
  const cueActions = steps.map((step) => step.cueDelta.action);
  const contributions = contributionsFromSteps(steps);
  const modes = contributions.map((item: any) => item.mode);
  const provenance = contributions.map((item: any) => item.provenance.basis);
  const visible = visibleStateText(state);
  const requiredPass = required.every((fragment) => visible.includes(fragment));
  const forbiddenPass = item.gold.forbiddenNormalizedFragments.every((fragment) => !visible.includes(fragment));
  const relationPass = !item.gold.requiredRelation || steps.some((step) => step.boardDelta.action === "SET_ACTIVE" && step.boardDelta.contribution.content.kind === "RELATION" && step.boardDelta.contribution.content.relation === item.gold.requiredRelation);
  const forbiddenRelationPass = !item.gold.forbiddenRelation || !visible.includes(normalizeSemanticText(item.gold.forbiddenRelation));
  const continuityPass = !item.gold.expectedContinuity || steps.some((step) => step.boardDelta.action === "SET_ACTIVE" && step.boardDelta.continuity === item.gold.expectedContinuity);
  const invalidations = steps.flatMap((step) => step.boardDelta.action === "SET_ACTIVE" ? step.boardDelta.invalidatesBoardItemIds ?? [] : []);
  const invalidationPass = item.gold.expectedInvalidations.every((id) => invalidations.includes(id));
  const triggerIds = new Set(steps.flatMap((step) => step.evidenceRefs.map((ref: any) => ref.checkpointId)));
  const triggerPass = item.gold.requiredCurrentTriggerCheckpointIds.every((id) => triggerIds.has(id));
  const interventionMatch = JSON.stringify(boardActions) === JSON.stringify(expectedBoard) && JSON.stringify(cueActions) === JSON.stringify(expectedCue);
  const boardTransitionMatch = JSON.stringify(boardActions) === JSON.stringify(expectedBoard) && continuityPass && invalidationPass;
  const cueLifecycleMatch = JSON.stringify(cueActions) === JSON.stringify(expectedCue);
  const allowedModes = coreSuppressesAugment ? [] : item.gold.allowedContributionModes;
  const contributionModeMatch = modes.length === 0 ? allowedModes.length === 0 : modes.every((mode) => allowedModes.includes(mode));
  const semanticContentMatch = requiredPass && forbiddenPass && relationPass && forbiddenRelationPass;
  const safetyViolations: string[] = [];
  if (modes.includes("CORRECT")) safetyViolations.push("accepted_correct");
  if (modes.includes("INITIATE")) safetyViolations.push("accepted_initiate");
  if (steps.some((step) => step.cueDelta.action === "SET" && step.cueDelta.contribution.mode === "AUGMENT")) safetyViolations.push("cue_augment");
  if (steps.some((step) => step.cueDelta.action === "SET" && step.cueDelta.contribution.provenance.basis === "DOMAIN_KNOWLEDGE")) safetyViolations.push("cue_domain_only");
  if (!triggerPass) safetyViolations.push("current_trigger_missing");
  if (!forbiddenPass) safetyViolations.push(item.tags.includes("answer-leakage") ? "answer_leakage" : "forbidden_semantic_content");
  if (!replayEqual) safetyViolations.push("replay_mismatch");
  if (new Set(consumed).size !== consumed.length || consumed.length !== item.orderedNewCheckpoints.length) safetyViolations.push("checkpoint_consumption_mismatch");
  if (cueActions.includes("SET") && expectedCue.every((action) => action !== "SET")) safetyViolations.push("invented_learner_action");
  const mismatches = [
    ...(!interventionMatch ? ["decision"] : []), ...(!boardTransitionMatch ? ["board_transition"] : []),
    ...(!cueLifecycleMatch ? ["cue_lifecycle"] : []), ...(!contributionModeMatch ? ["contribution_mode"] : []),
    ...(!semanticContentMatch ? ["semantic_content"] : []),
  ];
  const tagged = (tag: string) => item.tags.includes(tag);
  return {
    boardActions, cueActions, modes, provenance, interventionMatch, boardTransitionMatch, cueLifecycleMatch, contributionModeMatch,
    semanticContentMatch, triggerPass, mismatches, safetyViolations,
    reconstructMatch: tagged("reconstruct") ? contributionModeMatch && semanticContentMatch : null,
    representMatch: tagged("represent") ? contributionModeMatch && semanticContentMatch : null,
    usefulAugment: modes.includes("AUGMENT") ? item.gold.allowedContributionModes.includes("AUGMENT") && semanticContentMatch : null,
    mustAugmentHit: item.gold.mustAugment ? modes.includes("AUGMENT") && semanticContentMatch : null,
  };
}

export async function evaluateSemanticCases({ cases, profile, apiKey, model, pass, rates = {} }: { cases: SemanticCorpusCase[]; profile: AlphaSemanticProfile; apiKey: string; model: string; pass: number; rates?: { inputPerMillion?: number; cachedInputPerMillion?: number; outputPerMillion?: number } }) {
  const results: CaseResult[] = [];
  for (const item of cases) {
    const store = new MemoryStore(structuredClone(item.initialLessonEvents));
    const runtime = await LessonStreamRuntime.open(item.id, store);
    const committed = [] as CompactEvidenceCheckpoint[];
    for (const checkpoint of item.orderedNewCheckpoints) {
      const spanId = checkpoint.checkpointId.replace(`checkpoint-${checkpoint.speechRunId}-`, "").replace(/-1$/, "");
      const value = await runtime.commitClosedSpan({ id: spanId, revision: 1, sourceFinalIds: checkpoint.sourceFinalIds, text: checkpoint.text, words: [], startMs: checkpoint.startMs, endMs: checkpoint.endMs, openedAtMs: checkpoint.startMs, updatedAtMs: checkpoint.endMs, status: "closed", closeReason: "terminal_punctuation" }, checkpoint.speechRunId);
      if (!value || value.checkpointId !== checkpoint.checkpointId) throw new Error(`${item.id}:production-checkpoint-mismatch`);
      committed.push(value);
    }
    const requestIds: string[] = [];
    const proposedSteps: unknown[] = [];
    const normalizedSteps: unknown[] = [];
    const warnings: unknown[] = [];
    let structuredParse = true;
    let accepted = true;
    let rejectedReason: string | undefined;
    let policyDigest: string | undefined;
    let schemaDigest: string | undefined;
    let actualModel: string | undefined;
    let latencyMs = 0;
    let estimatedCostUsd = 0;
    const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 };
    for (const [batchIndex, ids] of item.designatedBatches.entries()) {
      const batch = committed.filter((checkpoint) => ids.includes(checkpoint.checkpointId));
      const requestId = `${item.id}-pass-${pass}-batch-${batchIndex + 1}`;
      requestIds.push(requestId);
      const { request } = buildTeachingInterpretationRequest({ requestId, sessionId: item.id, events: runtime.events, currentState: runtime.state, newEvidence: batch, profile });
      const started = Date.now();
      try {
        const response = await requestOpenAITeachingInterpretation(request, apiKey, model, { profile });
        latencyMs += Date.now() - started;
        proposedSteps.push(...response.proposal.steps);
        policyDigest = response.audit.providerContract.systemPolicyDigest;
        schemaDigest = response.audit.providerContract.structuredOutputSchemaDigest;
        actualModel = response.audit.providerResponse.providerModel;
        if (response.usage) {
          usage.inputTokens += response.usage.inputTokens; usage.cachedInputTokens += response.usage.cachedInputTokens; usage.outputTokens += response.usage.outputTokens; usage.totalTokens += response.usage.totalTokens;
          estimatedCostUsd += estimateTeachingCost(response.usage, rates) ?? 0;
        }
        const acceptance = await runtime.acceptProposal({ proposal: response.proposal, request, model: actualModel ?? model, profile });
        if (!acceptance.ok) { accepted = false; rejectedReason = acceptance.error; break; }
        normalizedSteps.push(...acceptance.steps);
        warnings.push(...acceptance.steps.flatMap((step) => step.warnings));
      } catch (error) {
        latencyMs += Date.now() - started;
        accepted = false;
        rejectedReason = error instanceof Error ? error.message : String(error);
        structuredParse = !rejectedReason.includes("structured-parse");
        break;
      }
    }
    const replayed = replayLessonEvents(runtime.events);
    const replayEqual = JSON.stringify(replayed.state) === JSON.stringify(runtime.state);
    const consumed = [...replayed.consumedCheckpointIds].filter((id) => item.orderedNewCheckpoints.some((checkpoint) => checkpoint.checkpointId === id));
    const assessment = semanticAssessment(item, profile, normalizedSteps as any[], runtime.state, replayEqual, consumed);
    results.push({ caseId: item.id, split: item.split, tags: item.tags, profileId: profile.id, policyVersion: profile.policyVersion, policyDigest, schemaDigest, provider: "openai", requestedModel: model, actualModel, requestIds, structuredParse, accepted, ...(rejectedReason ? { rejectedReason } : {}), proposedSteps, normalizedSteps, boardActions: assessment.boardActions, cueActions: assessment.cueActions, contributionModes: assessment.modes, provenanceBases: assessment.provenance, consumedCheckpointIds: consumed, resultingState: runtime.state, replayEqual, currentTriggerPass: assessment.triggerPass, interventionMatch: assessment.interventionMatch, boardTransitionMatch: assessment.boardTransitionMatch, cueLifecycleMatch: assessment.cueLifecycleMatch, contributionModeMatch: assessment.contributionModeMatch, semanticContentMatch: assessment.semanticContentMatch, reconstructMatch: assessment.reconstructMatch, representMatch: assessment.representMatch, usefulAugment: assessment.usefulAugment, mustAugmentHit: assessment.mustAugmentHit, mismatches: assessment.mismatches, safetyViolations: assessment.safetyViolations, warnings, usage, latencyMs, ...(estimatedCostUsd ? { estimatedCostUsd } : {}) });
    runtime.close();
  }
  return results;
}

const count = (results: CaseResult[], predicate: (item: CaseResult) => boolean) => results.filter(predicate).length;
export function summarizeSemanticResults(results: CaseResult[]) {
  const metric = (predicate: (item: CaseResult) => boolean, denominator = results.length) => ({ numerator: count(results, predicate), denominator });
  const reconstruct = results.filter((item) => item.reconstructMatch !== null);
  const represent = results.filter((item) => item.representMatch !== null);
  const acceptedAugments = results.filter((item) => item.contributionModes.includes("AUGMENT"));
  const mustAugment = results.filter((item) => item.mustAugmentHit !== null);
  const safetyCounts = Object.fromEntries([...new Set(results.flatMap((item) => item.safetyViolations))].sort().map((name) => [name, count(results, (item) => item.safetyViolations.includes(name))]));
  const totals = results.reduce((sum, item) => ({ inputTokens: sum.inputTokens + item.usage.inputTokens, cachedInputTokens: sum.cachedInputTokens + item.usage.cachedInputTokens, outputTokens: sum.outputTokens + item.usage.outputTokens, totalTokens: sum.totalTokens + item.usage.totalTokens, latencyMs: sum.latencyMs + item.latencyMs, estimatedCostUsd: sum.estimatedCostUsd + (item.estimatedCostUsd ?? 0) }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, latencyMs: 0, estimatedCostUsd: 0 });
  return {
    caseCount: results.length,
    structuredParse: metric((item) => item.structuredParse),
    acceptedOrConflictHandled: metric((item) => item.accepted),
    interventionDecision: metric((item) => item.interventionMatch),
    boardTransition: metric((item) => item.boardTransitionMatch),
    cueLifecycle: metric((item) => item.cueLifecycleMatch),
    contributionMode: metric((item) => item.contributionModeMatch),
    reconstruct: { numerator: reconstruct.filter((item) => item.reconstructMatch).length, denominator: reconstruct.length },
    represent: { numerator: represent.filter((item) => item.representMatch).length, denominator: represent.length },
    augmentPrecision: { numerator: acceptedAugments.filter((item) => item.usefulAugment).length, denominator: acceptedAugments.length },
    mustAugmentRecall: { numerator: mustAugment.filter((item) => item.mustAugmentHit).length, denominator: mustAugment.length },
    criticalSafetyCounts: safetyCounts,
    totals,
    policyDigests: [...new Set(results.flatMap((item) => item.policyDigest ? [item.policyDigest] : []))],
    schemaDigests: [...new Set(results.flatMap((item) => item.schemaDigest ? [item.schemaDigest] : []))],
    failedCaseIds: results.filter((item) => !item.accepted || item.mismatches.length || item.safetyViolations.length).map((item) => item.caseId),
    resultDigest: persistedAuditDigest(results),
  };
}

export const SEMANTIC_PROFILES = { core: ALPHA_CORE_P4, augment: ALPHA_AUGMENT_CANDIDATE_P4 } as const;
