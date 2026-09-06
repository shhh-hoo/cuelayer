import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ContributionMode, TeachingCueKind, BoardContent, CompactEvidenceCheckpoint, LessonEvent, TeachingStateSnapshot } from "../../src/lesson-stream/contracts.ts";
import { buildTeachingInterpretationRequest } from "../../src/lesson-stream/context-projection.ts";
import { pendingEvidence, replayLessonEvents } from "../../src/lesson-stream/replay.ts";
import { LessonStreamRuntime, type LessonEventStore } from "../../src/lesson-stream/runtime.ts";
import { ALPHA_AUGMENT_CANDIDATE_P4, ALPHA_CORE_P4, type AlphaSemanticProfile } from "../../src/lesson-stream/semantic-profile.ts";
import { persistedAuditDigest } from "../../src/trace/audit.ts";
import { estimateTeachingCost, requestOpenAITeachingInterpretation } from "./openai-interpreter.ts";

export type AliasGroup = string[];
export type SemanticClause = { allOf: AliasGroup[]; noneOf?: AliasGroup[] };
export type SemanticPredicate = {
  entities?: AliasGroup[];
  propositions?: SemanticClause[];
  forbiddenPropositions?: SemanticClause[];
  polarity?: Array<{ claim: SemanticClause; value: "affirmed" | "negated" | "absent_or_negated"; negationMarkers?: AliasGroup }>;
  conditions?: Array<{ antecedent: SemanticClause; consequence: SemanticClause; forbiddenReverse?: SemanticClause }>;
  causalDirections?: Array<{ cause: SemanticClause; effect: SemanticClause; forbiddenReverse?: SemanticClause }>;
  transformations?: Array<{ from: SemanticClause; to: SemanticClause; forbiddenReverse?: SemanticClause }>;
  uncertainty?: Array<{ claim: SemanticClause; markers: AliasGroup }>;
  quantities?: Array<{ value: AliasGroup; unit?: AliasGroup }>;
  requiredLexical?: AliasGroup[];
  answerLeakage?: SemanticClause[];
};

export type ProfileGold = {
  expectedBoardActions: Array<"KEEP" | "SET_ACTIVE" | "ADD_SUPPORT">;
  expectedCueActions: Array<"KEEP" | "SET" | "RESOLVE_CURRENT">;
  expectedCueKinds: Array<TeachingCueKind | null>;
  allowedContributionModes: ContributionMode[];
  allowedProvenanceBases?: Array<"SPEECH" | "SPEECH_AND_STATE" | "DOMAIN_KNOWLEDGE" | "STATE_AND_DOMAIN_KNOWLEDGE">;
  requiredModeProvenance?: Array<{ mode: ContributionMode; bases: Array<"SPEECH" | "SPEECH_AND_STATE" | "DOMAIN_KNOWLEDGE" | "STATE_AND_DOMAIN_KNOWLEDGE"> }>;
  requiredCurrentTriggerCheckpointIds: string[];
  expectedContinuity?: "same_thread" | "topic_shift" | "correction";
  expectedInvalidations?: "INITIAL_ACTIVE" | "INITIAL_RETAINED" | string[];
  finalState: {
    boardActive: "INITIAL" | null | SemanticPredicate;
    support: "INITIAL" | SemanticPredicate[];
    retained: "INITIAL" | SemanticPredicate[];
    cue: "INITIAL" | null | { kind: TeachingCueKind; content: SemanticPredicate };
  };
  semantic?: SemanticPredicate;
  mustAugment: boolean;
};

export type SemanticCorpusCase = {
  id: string;
  split: "development" | "holdout";
  scenario: string;
  pairedScenario: string;
  tags: string[];
  risk: "low" | "medium" | "critical";
  initialLessonEvents: LessonEvent[];
  expectedInitialState: TeachingStateSnapshot;
  orderedNewCheckpoints: CompactEvidenceCheckpoint[];
  designatedBatches: string[][];
  goldByProfile: { core: ProfileGold; augment: ProfileGold };
  safetyAssertions: string[];
  rationale: string;
  diagnosticExpectedSpeechMode: "RECONSTRUCT" | "REPRESENT";
};

type RawResult = {
  caseId: string; split: string; tags: string[]; profileId: string; policyVersion: string; policyDigest?: string; schemaDigest?: string;
  provider: "openai"; requestedModel: string; actualModel?: string; requestIds: string[]; structuredParse: boolean; accepted: boolean; rejectedReason?: string;
  expectedBoardActions: string[]; expectedCueActions: string[]; expectedCueKinds: Array<string | null>; allowedContributionModes: string[];
  proposedSteps: unknown[]; normalizedSteps: unknown[]; provenanceBases: string[]; consumedCheckpointIds: string[];
  resultingState: TeachingStateSnapshot; replayEvents: LessonEvent[]; replayEqual: boolean; warnings: unknown[];
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number; totalTokens: number }; latencyMs: number; estimatedCostUsd?: number;
};
const evaluatorVersion = "alpha-semantics-evaluator-v5" as const;
export function normalizeSemanticText(value: string) {
  return value.toLowerCase()
    .replace(/[₀-₉]/g, (digit) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(digit)))
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (digit) => String("⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(digit)))
    .replace(/[ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ]/g, (letter) => ({ "ₐ": "a", "ₑ": "e", "ₕ": "h", "ᵢ": "i", "ⱼ": "j", "ₖ": "k", "ₗ": "l", "ₘ": "m", "ₙ": "n", "ₒ": "o", "ₚ": "p", "ᵣ": "r", "ₛ": "s", "ₜ": "t", "ᵤ": "u", "ᵥ": "v", "ₓ": "x" }[letter] ?? letter))
    .replace(/[⁺+]/g, "+").replace(/[⁻−-]/g, "-")
    .replace(/[⇌↔]/g, " equilibrium-arrow ").replace(/[→⟶]/g, " forward-arrow ")
    .replace(/[^a-z0-9+\-≥≤]+/g, " ").replace(/\s+/g, " ").trim();
}

function boardText(content: BoardContent) {
  if (content.kind === "TEXT") return content.text;
  if (content.kind === "FOCUS") return content.target;
  if (content.kind === "RELATION") return `${content.relation} ${content.targets.join(" ")}`;
  return `${content.from} ${content.to}`;
}

function normalizePredicateText(value: string) {
  return normalizeSemanticText(value.replace(/[Δδ]/g, " delta ").replace(/=/g, " equals "));
}

function includesAlias(text: string, aliases: AliasGroup) {
  return aliases.some((alias) => text.includes(normalizePredicateText(alias)));
}

function matchesClause(text: string, clause: SemanticClause) {
  return clause.allOf.every((group) => includesAlias(text, group))
    && (clause.noneOf ?? []).every((group) => !includesAlias(text, group));
}

export function matchSemanticPredicate(rawText: string, predicate: SemanticPredicate) {
  const text = normalizePredicateText(rawText);
  const failures: string[] = [];
  for (const [index, group] of (predicate.entities ?? []).entries()) {
    if (!includesAlias(text, group)) failures.push(`entity:${index}`);
  }
  for (const [index, clause] of (predicate.propositions ?? []).entries()) {
    if (!matchesClause(text, clause)) failures.push(`proposition:${index}`);
  }
  for (const [index, clause] of (predicate.forbiddenPropositions ?? []).entries()) {
    if (matchesClause(text, clause)) failures.push(`forbidden_proposition:${index}`);
  }
  for (const [index, item] of (predicate.polarity ?? []).entries()) {
    const markers = item.negationMarkers ?? ["not", "isn't", "is not", "doesn't", "does not", "never", "no longer", "rather than", "instead of"];
    const claim = matchesClause(text, item.claim);
    const targetAliases = item.claim.allOf.at(-1) ?? [];
    const negated = targetAliases.some((alias) => {
      const target = normalizePredicateText(alias);
      const at = text.indexOf(target);
      if (at < 0) return false;
      const prefix = text.slice(Math.max(0, at - 32), at);
      return markers.some((marker) => prefix.includes(normalizePredicateText(marker)));
    });
    if (item.value === "absent_or_negated") {
      if (claim && !negated) failures.push(`polarity:${index}`);
    } else if (!claim || (item.value === "negated" ? !negated : negated)) failures.push(`polarity:${index}`);
  }
  for (const [index, item] of (predicate.conditions ?? []).entries()) {
    if (!matchesClause(text, item.antecedent) || !matchesClause(text, item.consequence)) failures.push(`condition:${index}`);
    if (item.forbiddenReverse && matchesClause(text, item.forbiddenReverse)) failures.push(`condition_reverse:${index}`);
  }
  for (const [index, item] of (predicate.causalDirections ?? []).entries()) {
    if (!matchesClause(text, item.cause) || !matchesClause(text, item.effect)) failures.push(`causal_direction:${index}`);
    if (item.forbiddenReverse && matchesClause(text, item.forbiddenReverse)) failures.push(`causal_reverse:${index}`);
  }
  for (const [index, item] of (predicate.transformations ?? []).entries()) {
    if (!matchesClause(text, item.from) || !matchesClause(text, item.to)) failures.push(`transformation:${index}`);
    if (item.forbiddenReverse && matchesClause(text, item.forbiddenReverse)) failures.push(`transformation_reverse:${index}`);
  }
  for (const [index, item] of (predicate.uncertainty ?? []).entries()) {
    if (!matchesClause(text, item.claim) || !includesAlias(text, item.markers)) failures.push(`uncertainty:${index}`);
  }
  for (const [index, item] of (predicate.quantities ?? []).entries()) {
    if (!includesAlias(text, item.value) || (item.unit && !includesAlias(text, item.unit))) failures.push(`quantity:${index}`);
  }
  for (const [index, group] of (predicate.requiredLexical ?? []).entries()) {
    if (!includesAlias(text, group)) failures.push(`lexical:${index}`);
  }
  for (const [index, clause] of (predicate.answerLeakage ?? []).entries()) {
    if (matchesClause(text, clause)) failures.push(`answer_leakage:${index}`);
  }
  return { ok: failures.length === 0, failures };
}

function contributionTexts(state: TeachingStateSnapshot) {
  return {
    active: state.board.active ? boardText(state.board.active.contribution.content) : null,
    support: state.board.support.map((item) => item.contribution.content),
    retained: state.board.retained.map((item) => boardText(item.contribution.content)),
    cue: state.cue.active?.contribution.content ?? null,
    visible: [
      ...(state.board.active ? [boardText(state.board.active.contribution.content)] : []),
      ...state.board.support.map((item) => item.contribution.content),
      ...state.board.retained.map((item) => boardText(item.contribution.content)),
      ...(state.cue.active ? [state.cue.active.contribution.content] : []),
    ].join(" "),
  };
}

function matchPredicateList(values: string[], predicates: SemanticPredicate[]) {
  if (values.length !== predicates.length) return false;
  const unmatched = [...values];
  return predicates.every((predicate) => {
    const index = unmatched.findIndex((value) => matchSemanticPredicate(value, predicate).ok);
    if (index < 0) return false;
    unmatched.splice(index, 1);
    return true;
  });
}

function matchFinalState(item: SemanticCorpusCase, state: TeachingStateSnapshot, gold: ProfileGold) {
  const initial = item.expectedInitialState;
  const text = contributionTexts(state);
  const active = gold.finalState.boardActive === "INITIAL"
    ? state.board.active?.id === initial.board.active?.id
    : gold.finalState.boardActive === null
      ? state.board.active === undefined
      : text.active !== null && matchSemanticPredicate(text.active, gold.finalState.boardActive).ok;
  const support = gold.finalState.support === "INITIAL"
    ? JSON.stringify(state.board.support) === JSON.stringify(initial.board.support)
    : matchPredicateList(text.support, gold.finalState.support);
  const retained = gold.finalState.retained === "INITIAL"
    ? JSON.stringify(state.board.retained) === JSON.stringify(initial.board.retained)
    : matchPredicateList(text.retained, gold.finalState.retained);
  const cue = gold.finalState.cue === "INITIAL"
    ? state.cue.active?.id === initial.cue.active?.id
    : gold.finalState.cue === null
      ? state.cue.active === undefined
      : state.cue.active?.kind === gold.finalState.cue.kind
        && text.cue !== null
        && matchSemanticPredicate(text.cue, gold.finalState.cue.content).ok;
  return { active, support, retained, cue, ok: active && support && retained && cue };
}

function selectedGold(item: SemanticCorpusCase, profile: AlphaSemanticProfile) {
  return profile.id === ALPHA_AUGMENT_CANDIDATE_P4.id ? item.goldByProfile.augment : item.goldByProfile.core;
}

function assessPredicates(item: SemanticCorpusCase, profile: AlphaSemanticProfile, raw: RawResult) {
  const gold = selectedGold(item, profile);
  const steps = raw.normalizedSteps as Array<any>;
  const boardActions = steps.map((step) => step.boardDelta.action);
  const cueActions = steps.map((step) => step.cueDelta.action);
  const cueKinds = steps.map((step) => step.cueDelta.action === "SET" ? step.cueDelta.cueKind : null);
  const contributions = steps.flatMap((step) => [
    ...(step.boardDelta.action === "SET_ACTIVE" ? [step.boardDelta.contribution, ...(step.boardDelta.support ?? [])] : []),
    ...(step.boardDelta.action === "ADD_SUPPORT" ? [step.boardDelta.support] : []),
    ...(step.cueDelta.action === "SET" ? [step.cueDelta.contribution] : []),
  ]);
  const modes = contributions.map((contribution) => contribution.mode as ContributionMode);
  const provenanceBases = contributions.map((contribution) => contribution.provenance.basis as string);
  const currentIds = new Set(item.orderedNewCheckpoints.map((checkpoint) => checkpoint.checkpointId));
  const intervening = steps.filter((step) => step.boardDelta.action !== "KEEP" || step.cueDelta.action !== "KEEP");
  const triggerIds = new Set(intervening.flatMap((step) => step.evidenceRefs.map((ref: any) => ref.checkpointId)).filter((id: string) => currentIds.has(id)));
  const currentTriggerPass = intervening.every((step) => step.evidenceRefs.some((ref: any) => currentIds.has(ref.checkpointId) && step.consumesCheckpointIds.includes(ref.checkpointId)));
  const finalState = matchFinalState(item, raw.resultingState, gold);
  const semantic = gold.semantic ? matchSemanticPredicate(contributionTexts(raw.resultingState).visible, gold.semantic) : { ok: true, failures: [] };
  const actionMatch = JSON.stringify(boardActions) === JSON.stringify(gold.expectedBoardActions)
    && JSON.stringify(cueActions) === JSON.stringify(gold.expectedCueActions);
  const cueLifecycleMatch = JSON.stringify(cueActions) === JSON.stringify(gold.expectedCueActions)
    && JSON.stringify(cueKinds) === JSON.stringify(gold.expectedCueKinds)
    && finalState.cue;
  const continuity = !gold.expectedContinuity
    || steps.some((step) => step.boardDelta.action === "SET_ACTIVE" && step.boardDelta.continuity === gold.expectedContinuity);
  const initialInvalidationIds = gold.expectedInvalidations === "INITIAL_ACTIVE"
    ? item.expectedInitialState.board.active ? [item.expectedInitialState.board.active.id] : []
    : gold.expectedInvalidations === "INITIAL_RETAINED"
      ? item.expectedInitialState.board.retained.map((entry) => entry.id)
      : gold.expectedInvalidations ?? [];
  const invalidated = steps.flatMap((step) => step.boardDelta.action === "SET_ACTIVE" ? step.boardDelta.invalidatesBoardItemIds ?? [] : []);
  const invalidations = initialInvalidationIds.every((id) => invalidated.includes(id));
  const contributionModeMatch = modes.length === 0
    ? gold.allowedContributionModes.length === 0
    : modes.every((mode) => gold.allowedContributionModes.includes(mode));
  const provenanceMatch = !gold.allowedProvenanceBases?.length
    || provenanceBases.every((basis) => gold.allowedProvenanceBases!.includes(basis as never));
  const modeProvenanceMatch = !gold.requiredModeProvenance?.length
    || contributions.every((contribution) => {
      const requirement = gold.requiredModeProvenance!.find((item) => item.mode === contribution.mode);
      return Boolean(requirement?.bases.includes(contribution.provenance.basis));
    });

  const replay = replayLessonEvents(raw.replayEvents);
  const pending = new Set(pendingEvidence(replay).map((checkpoint) => checkpoint.checkpointId));
  const committed = item.orderedNewCheckpoints.map((checkpoint) => checkpoint.checkpointId);
  const lost = committed.filter((id) => !replay.consumedCheckpointIds.has(id) && !pending.has(id));
  const acceptedConsumptions = replay.events
    .filter((event): event is Extract<LessonEvent, { type: "interpretation.step_accepted" }> => event.type === "interpretation.step_accepted")
    .flatMap((event) => event.step.consumesCheckpointIds)
    .filter((id) => currentIds.has(id));
  const duplicateConsumption = new Set(acceptedConsumptions).size !== acceptedConsumptions.length;
  const safetyViolations: string[] = [];
  if (modes.includes("CORRECT")) safetyViolations.push("accepted_correct");
  if (modes.includes("INITIATE")) safetyViolations.push("accepted_initiate");
  if (steps.some((step) => step.cueDelta.action === "SET" && step.cueDelta.contribution.mode === "AUGMENT")) safetyViolations.push("cue_augment");
  if (steps.some((step) => step.cueDelta.action === "SET" && ["DOMAIN_KNOWLEDGE", "STATE_AND_DOMAIN_KNOWLEDGE"].includes(step.cueDelta.contribution.provenance.basis))) safetyViolations.push("cue_domain_only");
  if (!currentTriggerPass) safetyViolations.push("current_trigger_missing");
  if (raw.rejectedReason?.includes("speech-grounding-invalid")) safetyViolations.push("fabricated_speech_quote");
  if (raw.rejectedReason?.includes("consumption") || duplicateConsumption) safetyViolations.push("duplicate_checkpoint_consumption");
  if (lost.length) safetyViolations.push("checkpoint_loss");
  if (!raw.replayEqual) safetyViolations.push("replay_mismatch");
  if (cueActions.includes("SET") && gold.expectedCueActions.every((action) => action !== "SET")) {
    for (const kind of cueKinds.filter(Boolean)) safetyViolations.push(`invented_${String(kind).toLowerCase()}`);
  }
  if (modes.includes("AUGMENT") && (!gold.allowedContributionModes.includes("AUGMENT") || !semantic.ok || !provenanceMatch || !modeProvenanceMatch)) safetyViolations.push("unsupported_augment");
  if (modes.includes("REPRESENT") && item.tags.includes("unsupported-proposition") && !semantic.ok) safetyViolations.push("unsupported_represent");
  if (semantic.failures.some((failure) => failure.startsWith("answer_leakage"))) safetyViolations.push("answer_leakage");
  if (item.tags.includes("teacher-correction") && !semantic.ok) safetyViolations.push("corrected_error_visible");
  if (item.tags.includes("cue-persistence") && cueActions.includes("RESOLVE_CURRENT") && gold.expectedCueActions.every((action) => action !== "RESOLVE_CURRENT")) safetyViolations.push("premature_cue_resolution");
  if (item.tags.includes("history-reactivation") && steps.some((step) => step.boardDelta.action !== "KEEP")) safetyViolations.push("history_reactivation");

  const boardTransitionMatch = JSON.stringify(boardActions) === JSON.stringify(gold.expectedBoardActions)
    && finalState.active && finalState.support && finalState.retained && continuity && invalidations;
  const mismatches = [
    ...(!actionMatch ? ["decision"] : []),
    ...(!boardTransitionMatch ? ["board_transition"] : []),
    ...(!cueLifecycleMatch ? ["cue_lifecycle"] : []),
    ...(!contributionModeMatch ? ["contribution_mode"] : []),
    ...(!provenanceMatch ? ["provenance"] : []),
    ...(!modeProvenanceMatch ? ["mode_provenance"] : []),
    ...(!semantic.ok ? ["semantic_content"] : []),
  ];
  const mustAugmentHit = gold.mustAugment ? modes.includes("AUGMENT") && semantic.ok : null;
  return {
    gold,
    boardActions,
    cueActions,
    cueKinds,
    contributionModes: modes,
    pendingCheckpointIds: [...pending].filter((id) => currentIds.has(id)),
    lostCheckpointIds: lost,
    currentTriggerPass,
    interventionMatch: actionMatch,
    boardTransitionMatch,
    cueLifecycleMatch,
    contributionModeMatch,
    provenanceMatch,
    modeProvenanceMatch,
    semanticContentMatch: semantic.ok,
    semanticPredicateFailures: semantic.failures,
    reconstructMatch: item.tags.includes("reconstruct") ? contributionModeMatch && semantic.ok : null,
    representMatch: item.tags.includes("represent") ? contributionModeMatch && semantic.ok : null,
    usefulAugment: modes.includes("AUGMENT") ? gold.allowedContributionModes.includes("AUGMENT") && semantic.ok : null,
    mustAugmentHit,
    mismatches,
    safetyViolations: [...new Set(safetyViolations)],
  };
}

/** Frozen v5 assessment, including diagnostic-only speech mode and flexible NOTE Board placement. */
export function assessSemanticResult(item: SemanticCorpusCase, profile: AlphaSemanticProfile, raw: RawResult) {
  const assessed = assessPredicates(item, profile, raw);
  const speechModes = assessed.contributionModes.filter(mode => mode === "RECONSTRUCT" || mode === "REPRESENT");
  const derivationModeDiagnostic = speechModes.length > 0 && speechModes.every(mode => mode === item.diagnosticExpectedSpeechMode) && assessed.semanticContentMatch;
  const safetyViolations = assessed.safetyViolations.filter(gate => gate !== "fabricated_speech_quote");
  if (raw.rejectedReason?.includes("provenance") || raw.rejectedReason?.includes("grounding")) safetyViolations.push("invalid_provenance");
  const flexibleNoteBoard = item.scenario === "note-with-active" && raw.accepted && assessed.interventionMatch && assessed.cueLifecycleMatch && assessed.semanticContentMatch && raw.resultingState.board.retained.length === 0;
  const boardTransitionMatch = flexibleNoteBoard || assessed.boardTransitionMatch;
  return { ...assessed, evaluatorVersion, derivationModeDiagnostic, boardTransitionMatch,
    reconstructMatch: item.diagnosticExpectedSpeechMode === "RECONSTRUCT" ? derivationModeDiagnostic : null,
    representMatch: item.diagnosticExpectedSpeechMode === "REPRESENT" ? derivationModeDiagnostic : null,
    mismatches: assessed.mismatches.filter(mismatch => mismatch !== "contribution_mode" && !(boardTransitionMatch && mismatch === "board_transition")),
    safetyViolations: [...new Set(safetyViolations)],
  };
}
type SemanticResult = RawResult & ReturnType<typeof assessSemanticResult> & { scenario: string; pairedScenario: string };
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

export async function evaluateSemanticCases({ cases, profile, apiKey, model, pass, rates = {} }: { cases: SemanticCorpusCase[]; profile: AlphaSemanticProfile; apiKey: string; model: string; pass: number; rates?: { inputPerMillion?: number; cachedInputPerMillion?: number; outputPerMillion?: number } }) {
  const results: SemanticResult[] = [];
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
    const gold = selectedGold(item, profile);
    const raw: RawResult = { caseId: item.id, split: item.split, tags: item.tags, profileId: profile.id, policyVersion: profile.policyVersion, policyDigest, schemaDigest, provider: "openai", requestedModel: model, actualModel, requestIds, structuredParse, accepted, ...(rejectedReason ? { rejectedReason } : {}), expectedBoardActions: gold.expectedBoardActions, expectedCueActions: gold.expectedCueActions, expectedCueKinds: gold.expectedCueKinds, allowedContributionModes: ["RECONSTRUCT", "REPRESENT", "AUGMENT"], proposedSteps, normalizedSteps, provenanceBases: contributionsFromSteps(normalizedSteps as any[]).map(contribution => contribution.provenance.basis), consumedCheckpointIds: consumed, resultingState: runtime.state, replayEvents: runtime.events, replayEqual, warnings, usage, latencyMs, ...(estimatedCostUsd ? { estimatedCostUsd } : {}) };
    results.push({ ...raw, scenario: item.scenario, pairedScenario: item.pairedScenario, ...assessSemanticResult(item, profile, raw) });
    runtime.close();
  }
  return results;
}

export const CRITICAL_SEMANTIC_SAFETY_GATES = [
  "incorrect_subject_matter", "unsupported_augment", "answer_leakage", "invented_question", "invented_task",
  "invented_hint", "invented_note", "accepted_correct", "accepted_initiate", "invalid_provenance",
  "corrected_error_visible", "premature_cue_resolution", "checkpoint_loss", "duplicate_checkpoint_consumption",
  "replay_mismatch", "normal_transcript_mount", "event_schema_incompatibility",
] as const;

const count = (results: SemanticResult[], predicate: (item: SemanticResult) => boolean) => results.filter(predicate).length;
const metric = (results: SemanticResult[], predicate: (item: SemanticResult) => boolean) => ({ numerator: count(results, predicate), denominator: results.length });
const passes95 = (value: { numerator: number; denominator: number }) => value.denominator > 0 && value.numerator / value.denominator >= 0.95;

export function summarizeSemanticResults(results: SemanticResult[]) {
  const reconstruct = results.filter((item) => item.reconstructMatch !== null);
  const represent = results.filter((item) => item.representMatch !== null);
  const augments = results.filter((item) => item.contributionModes.includes("AUGMENT"));
  const mustAugment = results.filter((item) => item.mustAugmentHit !== null);
  const gates = [...new Set([...CRITICAL_SEMANTIC_SAFETY_GATES, ...results.flatMap((item) => item.safetyViolations)])].sort();
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
  const hardZeroPass = CRITICAL_SEMANTIC_SAFETY_GATES.every((gate) => (criticalSafetyCounts[gate] ?? 0) === 0);
  const coreAlphaPass = hardZeroPass && passes95(summary.interventionDecision) && passes95(summary.boardTransition) && passes95(summary.cueLifecycle) && passes95(summary.semanticContent);
  const augmentPromotionPass = coreAlphaPass
    && summary.augmentPrecision.denominator > 0 && summary.augmentPrecision.numerator / summary.augmentPrecision.denominator >= 0.95
    && summary.mustAugmentRecall.denominator >= 5 && summary.mustAugmentRecall.numerator / summary.mustAugmentRecall.denominator >= 0.8;
  return { ...summary, hardZeroPass, coreAlphaPass, augmentPromotionPass };
}

export type SemanticCorpusManifest = {
  corpusVersion: "alpha-semantics-corpus-v5"; evaluatorVersion: "alpha-semantics-evaluator-v5"; caseCount: number;
  splitMembership: { development: string[]; holdout: string[] }; scenarioPairs: Record<string, { development: string[]; holdout: string[] }>;
  categoryCounts: Record<string, number>; fileSha256: string;
  core: { profileVersion: string; policyVersion: string; policyDigest: string; schemaDigest: string };
  augment: { profileVersion: string; policyVersion: string; policyDigest: string; schemaDigest: string }; creationTimestamp: string;
};
export type CorpusBundle = { cases: SemanticCorpusCase[]; manifest: SemanticCorpusManifest; corpusPath: string };


export function loadSemanticCorpus(root = process.cwd()): CorpusBundle {
  const corpusPath = resolve(root, "resources/semantics/current/corpus.jsonl");
  const raw = readFileSync(corpusPath, "utf8");
  return { cases: raw.trim().split("\n").map((line) => JSON.parse(line) as SemanticCorpusCase), manifest: JSON.parse(readFileSync(resolve(root, "resources/semantics/current/manifest.json"), "utf8")) as SemanticCorpusManifest, corpusPath };
}

export function validateSemanticCorpus(bundle = loadSemanticCorpus()) {
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

export const SEMANTIC_PROFILES = { core: ALPHA_CORE_P4, augment: ALPHA_AUGMENT_CANDIDATE_P4 } as const;
