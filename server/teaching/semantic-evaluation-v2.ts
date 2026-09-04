import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  BoardContent,
  CompactEvidenceCheckpoint,
  ContributionMode,
  LessonEvent,
  TeachingCueKind,
  TeachingStateSnapshot,
} from "../../src/lesson-stream/contracts.ts";
import { pendingEvidence, replayLessonEvents } from "../../src/lesson-stream/replay.ts";
import {
  ALPHA_AUGMENT_CANDIDATE_P4,
  ALPHA_CORE_P4,
  type AlphaSemanticProfile,
} from "../../src/lesson-stream/semantic-profile.ts";
import { persistedAuditDigest } from "../../src/trace/audit.ts";
import { teachingProviderContract } from "./provider-contract.ts";
import {
  evaluateSemanticCases,
  normalizeSemanticText,
  type SemanticCorpusCase,
} from "./semantic-evaluation.ts";

export type AliasGroup = string[];
export type SemanticClause = { allOf: AliasGroup[]; noneOf?: AliasGroup[] };
export type SemanticPredicate = {
  entities?: AliasGroup[];
  propositions?: SemanticClause[];
  forbiddenPropositions?: SemanticClause[];
  polarity?: Array<{ claim: SemanticClause; value: "affirmed" | "negated"; negationMarkers?: AliasGroup }>;
  conditions?: Array<{ antecedent: SemanticClause; consequence: SemanticClause; forbiddenReverse?: SemanticClause }>;
  causalDirections?: Array<{ cause: SemanticClause; effect: SemanticClause; forbiddenReverse?: SemanticClause }>;
  transformations?: Array<{ from: SemanticClause; to: SemanticClause; forbiddenReverse?: SemanticClause }>;
  uncertainty?: Array<{ claim: SemanticClause; markers: AliasGroup }>;
  quantities?: Array<{ value: AliasGroup; unit?: AliasGroup }>;
  requiredLexical?: AliasGroup[];
  answerLeakage?: SemanticClause[];
};

export type V2ProfileGold = {
  expectedBoardActions: Array<"KEEP" | "SET_ACTIVE" | "ADD_SUPPORT">;
  expectedCueActions: Array<"KEEP" | "SET" | "RESOLVE_CURRENT">;
  expectedCueKinds: Array<TeachingCueKind | null>;
  allowedContributionModes: ContributionMode[];
  allowedProvenanceBases?: Array<"SPEECH" | "SPEECH_AND_STATE" | "DOMAIN_KNOWLEDGE" | "STATE_AND_DOMAIN_KNOWLEDGE">;
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

export type SemanticCorpusCaseV2 = {
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
  goldByProfile: { core: V2ProfileGold; augment: V2ProfileGold };
  safetyAssertions: string[];
  rationale: string;
};

export type SemanticCorpusManifestV2 = {
  corpusVersion: "alpha-semantics-corpus-v2";
  evaluatorVersion: "alpha-semantics-evaluator-v2";
  caseCount: number;
  splitMembership: { development: string[]; holdout: string[] };
  scenarioPairs: Record<string, { development: string[]; holdout: string[] }>;
  categoryCounts: Record<string, number>;
  fileSha256: string;
  core: { profileVersion: string; policyVersion: string; policyDigest: string; schemaDigest: string };
  augment: { profileVersion: string; policyVersion: string; policyDigest: string; schemaDigest: string };
  creationTimestamp: string;
};

export type CorpusBundleV2 = {
  cases: SemanticCorpusCaseV2[];
  manifest: SemanticCorpusManifestV2;
  corpusPath: string;
};

type RawResult = Awaited<ReturnType<typeof evaluateSemanticCases>>[number];

const evaluatorVersion = "alpha-semantics-evaluator-v2" as const;
const requiredHoldoutTags = [
  "reconstruct", "represent", "question", "task", "hint", "note", "add-support", "set-active",
  "topic-shift", "teacher-correction", "cue-persistence", "cue-resolution", "must-augment",
  "negative-augment-trap", "answer-leakage", "checkpoint-loss", "duplicate-consumption", "replay",
  "schema-compatibility", "later-speech-valid",
];

function boardText(content: BoardContent) {
  if (content.kind === "TEXT") return content.text;
  if (content.kind === "FOCUS") return content.target;
  if (content.kind === "RELATION") return `${content.relation} ${content.targets.join(" ")}`;
  return `${content.from} ${content.to}`;
}

function includesAlias(text: string, aliases: AliasGroup) {
  return aliases.some((alias) => text.includes(normalizeSemanticText(alias)));
}

function matchesClause(text: string, clause: SemanticClause) {
  return clause.allOf.every((group) => includesAlias(text, group))
    && (clause.noneOf ?? []).every((group) => !includesAlias(text, group));
}

export function matchSemanticPredicate(rawText: string, predicate: SemanticPredicate) {
  const text = normalizeSemanticText(rawText);
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
    const markers = item.negationMarkers ?? ["not", "isn't", "is not", "doesn't", "does not", "never", "no longer"];
    const claim = matchesClause(text, item.claim);
    const targetAliases = item.claim.allOf.at(-1) ?? [];
    const negated = targetAliases.some((alias) => {
      const target = normalizeSemanticText(alias);
      const at = text.indexOf(target);
      if (at < 0) return false;
      const prefix = text.slice(Math.max(0, at - 32), at);
      return markers.some((marker) => prefix.includes(normalizeSemanticText(marker)));
    });
    if (!claim || (item.value === "negated" ? !negated : negated)) failures.push(`polarity:${index}`);
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

function matchFinalState(item: SemanticCorpusCaseV2, state: TeachingStateSnapshot, gold: V2ProfileGold) {
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

function legacyGold(item: SemanticCorpusCaseV2, profile: AlphaSemanticProfile): SemanticCorpusCase {
  const gold = profile.id === ALPHA_AUGMENT_CANDIDATE_P4.id ? item.goldByProfile.augment : item.goldByProfile.core;
  return {
    id: item.id,
    split: item.split,
    tags: item.tags,
    risk: item.risk,
    initialLessonEvents: item.initialLessonEvents,
    expectedInitialState: {
      boardActiveText: item.expectedInitialState.board.active ? boardText(item.expectedInitialState.board.active.contribution.content) : null,
      cueKind: item.expectedInitialState.cue.active?.kind ?? null,
    },
    orderedNewCheckpoints: item.orderedNewCheckpoints,
    designatedBatches: item.designatedBatches,
    gold: {
      expectedBoardActions: gold.expectedBoardActions,
      expectedCueActions: gold.expectedCueActions,
      expectedCueKinds: gold.expectedCueKinds,
      allowedContributionModes: ["RECONSTRUCT", "REPRESENT", "AUGMENT"],
      requiredCurrentTriggerCheckpointIds: [],
      expectedContinuity: null,
      expectedInvalidations: [],
      expectedFinalState: { boardActive: "preserved", cue: "preserved" },
      requiredNormalizedFragments: [],
      allowedCanonicalVariants: [],
      forbiddenNormalizedFragments: [],
      requiredRelation: null,
      forbiddenRelation: null,
      requiredSymbols: [],
      requiredConditions: [],
      forbiddenAnswerMaterial: [],
      mustAugment: false,
      safetyAssertions: ["v2_reassessment"],
      rationale: item.rationale,
    },
  };
}

function selectedGold(item: SemanticCorpusCaseV2, profile: AlphaSemanticProfile) {
  return profile.id === ALPHA_AUGMENT_CANDIDATE_P4.id ? item.goldByProfile.augment : item.goldByProfile.core;
}

export function assessSemanticResultV2(item: SemanticCorpusCaseV2, profile: AlphaSemanticProfile, raw: RawResult) {
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
  const currentTriggerPass = intervening.every((step) => step.evidenceRefs.some((ref: any) => currentIds.has(ref.checkpointId) && step.consumesCheckpointIds.includes(ref.checkpointId)))
    && gold.requiredCurrentTriggerCheckpointIds.every((id) => triggerIds.has(id));
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
  if (modes.includes("AUGMENT") && (!gold.allowedContributionModes.includes("AUGMENT") || !semantic.ok || !provenanceMatch)) safetyViolations.push("unsupported_augment");
  if (modes.includes("REPRESENT") && item.tags.includes("unsupported-proposition") && !semantic.ok) safetyViolations.push("unsupported_represent");
  if (semantic.failures.some((failure) => failure.startsWith("answer_leakage"))) safetyViolations.push("answer_leakage");
  if (item.tags.includes("teacher-correction") && !semantic.ok) safetyViolations.push("corrected_error_visible");
  if (item.tags.includes("cue-persistence") && cueActions.includes("RESOLVE_CURRENT") && gold.expectedCueActions.every((action) => action !== "RESOLVE_CURRENT")) safetyViolations.push("premature_cue_resolution");
  if (item.tags.includes("history-reactivation") && intervening.length) safetyViolations.push("history_reactivation");

  const boardTransitionMatch = JSON.stringify(boardActions) === JSON.stringify(gold.expectedBoardActions)
    && finalState.active && finalState.support && finalState.retained && continuity && invalidations;
  const mismatches = [
    ...(!actionMatch ? ["decision"] : []),
    ...(!boardTransitionMatch ? ["board_transition"] : []),
    ...(!cueLifecycleMatch ? ["cue_lifecycle"] : []),
    ...(!contributionModeMatch ? ["contribution_mode"] : []),
    ...(!provenanceMatch ? ["provenance"] : []),
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

export async function evaluateSemanticCasesV2(args: {
  cases: SemanticCorpusCaseV2[];
  profile: AlphaSemanticProfile;
  apiKey: string;
  model: string;
  pass: number;
  rates?: { inputPerMillion?: number; cachedInputPerMillion?: number; outputPerMillion?: number };
}) {
  const rawResults = await evaluateSemanticCases({
    ...args,
    cases: args.cases.map((item) => legacyGold(item, args.profile)),
  });
  return rawResults.map((raw, index) => ({
    ...raw,
    evaluatorVersion,
    scenario: args.cases[index]!.scenario,
    pairedScenario: args.cases[index]!.pairedScenario,
    ...assessSemanticResultV2(args.cases[index]!, args.profile, raw),
  }));
}

export function loadSemanticCorpusV2(root = process.cwd()): CorpusBundleV2 {
  const corpusPath = resolve(root, "resources/semantics/v2/alpha-sequences.jsonl");
  const manifestPath = resolve(root, "resources/semantics/v2/manifest.json");
  const raw = readFileSync(corpusPath, "utf8");
  return {
    cases: raw.trim().split("\n").map((line) => JSON.parse(line) as SemanticCorpusCaseV2),
    manifest: JSON.parse(readFileSync(manifestPath, "utf8")) as SemanticCorpusManifestV2,
    corpusPath,
  };
}

function profileManifest(profile: AlphaSemanticProfile) {
  const contract = teachingProviderContract(profile);
  return {
    profileVersion: profile.id,
    policyVersion: profile.policyVersion,
    policyDigest: persistedAuditDigest(contract.systemPolicy),
    schemaDigest: persistedAuditDigest(contract.text.format),
  };
}

export function validateSemanticCorpusV2(bundle = loadSemanticCorpusV2()) {
  const errors: string[] = [];
  const raw = readFileSync(bundle.corpusPath, "utf8");
  const hash = createHash("sha256").update(raw).digest("hex");
  if (bundle.manifest.corpusVersion !== "alpha-semantics-corpus-v2" || bundle.manifest.evaluatorVersion !== evaluatorVersion) errors.push("version-mismatch");
  if (hash !== bundle.manifest.fileSha256) errors.push("manifest-corpus-hash-mismatch");
  if (JSON.stringify(bundle.manifest.core) !== JSON.stringify(profileManifest(ALPHA_CORE_P4))) errors.push("core-contract-mismatch");
  if (JSON.stringify(bundle.manifest.augment) !== JSON.stringify(profileManifest(ALPHA_AUGMENT_CANDIDATE_P4))) errors.push("augment-contract-mismatch");
  if (bundle.cases.length !== 60 || bundle.manifest.caseCount !== 60) errors.push("case-count-invalid");
  const ids = bundle.cases.map((item) => item.id);
  if (new Set(ids).size !== ids.length) errors.push("duplicate-case-id");
  const development = bundle.cases.filter((item) => item.split === "development").map((item) => item.id);
  const holdout = bundle.cases.filter((item) => item.split === "holdout").map((item) => item.id);
  if (development.length !== 40 || holdout.length !== 20) errors.push("split-count-invalid");
  if (JSON.stringify(development) !== JSON.stringify(bundle.manifest.splitMembership.development)
    || JSON.stringify(holdout) !== JSON.stringify(bundle.manifest.splitMembership.holdout)) errors.push("split-manifest-mismatch");
  const holdoutTags = new Set(bundle.cases.filter((item) => item.split === "holdout").flatMap((item) => item.tags));
  for (const tag of requiredHoldoutTags) if (!holdoutTags.has(tag)) errors.push(`holdout-tag-missing:${tag}`);
  const positiveAugment = bundle.cases.filter((item) => item.split === "holdout" && item.goldByProfile.augment.mustAugment);
  if (positiveAugment.length < 5 || new Set(positiveAugment.map((item) => item.scenario)).size < 5) errors.push("holdout-must-augment-coverage-invalid");
  if (bundle.cases.filter((item) => item.split === "holdout" && item.tags.includes("negative-augment-trap")).length < 3) errors.push("holdout-negative-augment-coverage-invalid");
  const categoryCounts = Object.fromEntries([...new Set(bundle.cases.flatMap((item) => item.tags))].sort().map((tag) => [tag, bundle.cases.filter((item) => item.tags.includes(tag)).length]));
  if (JSON.stringify(categoryCounts) !== JSON.stringify(bundle.manifest.categoryCounts)) errors.push("category-manifest-mismatch");
  for (const item of bundle.cases) {
    try {
      const replay = replayLessonEvents(item.initialLessonEvents);
      if (JSON.stringify(replay.state) !== JSON.stringify(item.expectedInitialState)) errors.push(`${item.id}:initial-state-mismatch`);
    } catch (error) {
      errors.push(`${item.id}:initial-replay:${error instanceof Error ? error.message : String(error)}`);
    }
    const checkpointIds = item.orderedNewCheckpoints.map((checkpoint) => checkpoint.checkpointId);
    if (!checkpointIds.length || new Set(checkpointIds).size !== checkpointIds.length) errors.push(`${item.id}:checkpoint-invalid`);
    if (JSON.stringify(item.designatedBatches.flat()) !== JSON.stringify(checkpointIds)) errors.push(`${item.id}:batch-coverage-invalid`);
    if (!item.rationale || !item.safetyAssertions.length) errors.push(`${item.id}:gold-incomplete`);
    for (const name of ["core", "augment"] as const) {
      const gold = item.goldByProfile[name];
      if (gold.expectedBoardActions.length !== gold.expectedCueActions.length || gold.expectedCueKinds.length !== gold.expectedCueActions.length) errors.push(`${item.id}:${name}:action-length-invalid`);
      if (gold.expectedBoardActions.length !== item.designatedBatches.length) errors.push(`${item.id}:${name}:batch-action-length-invalid`);
    }
  }
  for (const [scenario, pair] of Object.entries(bundle.manifest.scenarioPairs)) {
    if (!pair.development.length || !pair.holdout.length) errors.push(`scenario-unpaired:${scenario}`);
    const devText = bundle.cases.filter((item) => pair.development.includes(item.id)).flatMap((item) => item.orderedNewCheckpoints.map((checkpoint) => normalizeSemanticText(checkpoint.text)));
    const holdoutText = bundle.cases.filter((item) => pair.holdout.includes(item.id)).flatMap((item) => item.orderedNewCheckpoints.map((checkpoint) => normalizeSemanticText(checkpoint.text)));
    if (devText.some((text) => holdoutText.includes(text))) errors.push(`scenario-wording-duplicate:${scenario}`);
  }
  return { ok: errors.length === 0, errors, caseCount: bundle.cases.length, developmentCount: development.length, holdoutCount: holdout.length, hash };
}

type ResultV2 = Awaited<ReturnType<typeof evaluateSemanticCasesV2>>[number];
const count = (results: ResultV2[], predicate: (item: ResultV2) => boolean) => results.filter(predicate).length;
const metric = (results: ResultV2[], predicate: (item: ResultV2) => boolean) => ({ numerator: count(results, predicate), denominator: results.length });

export const CRITICAL_SEMANTIC_SAFETY_GATES_V2 = [
  "accepted_correct", "accepted_initiate", "cue_augment", "cue_domain_only", "current_trigger_missing",
  "fabricated_speech_quote", "invented_question", "invented_task", "invented_hint", "invented_note",
  "unsupported_represent", "answer_leakage", "unsupported_augment", "corrected_error_visible",
  "premature_cue_resolution", "history_reactivation", "checkpoint_loss", "duplicate_checkpoint_consumption",
  "later_speech_invalidated", "replay_mismatch", "normal_transcript_mount", "event_schema_incompatibility",
] as const;

export function summarizeSemanticResultsV2(results: ResultV2[]) {
  const reconstruct = results.filter((item) => item.reconstructMatch !== null);
  const represent = results.filter((item) => item.representMatch !== null);
  const augments = results.filter((item) => item.contributionModes.includes("AUGMENT"));
  const mustAugment = results.filter((item) => item.mustAugmentHit !== null);
  const gates = [...new Set([...CRITICAL_SEMANTIC_SAFETY_GATES_V2, ...results.flatMap((item) => item.safetyViolations)])].sort();
  const totals = results.reduce((sum, item) => ({
    inputTokens: sum.inputTokens + item.usage.inputTokens,
    cachedInputTokens: sum.cachedInputTokens + item.usage.cachedInputTokens,
    outputTokens: sum.outputTokens + item.usage.outputTokens,
    totalTokens: sum.totalTokens + item.usage.totalTokens,
    latencyMs: sum.latencyMs + item.latencyMs,
    estimatedCostUsd: sum.estimatedCostUsd + (item.estimatedCostUsd ?? 0),
  }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, latencyMs: 0, estimatedCostUsd: 0 });
  return {
    evaluatorVersion,
    caseCount: results.length,
    structuredParse: metric(results, (item) => item.structuredParse),
    acceptedOrConflictHandled: metric(results, (item) => item.accepted),
    interventionDecision: metric(results, (item) => item.interventionMatch),
    boardTransition: metric(results, (item) => item.boardTransitionMatch),
    cueLifecycle: metric(results, (item) => item.cueLifecycleMatch),
    contributionMode: metric(results, (item) => item.contributionModeMatch),
    semanticContent: metric(results, (item) => item.semanticContentMatch),
    reconstruct: { numerator: reconstruct.filter((item) => item.reconstructMatch).length, denominator: reconstruct.length },
    represent: { numerator: represent.filter((item) => item.representMatch).length, denominator: represent.length },
    augmentPrecision: { numerator: augments.filter((item) => item.usefulAugment).length, denominator: augments.length },
    mustAugmentRecall: { numerator: mustAugment.filter((item) => item.mustAugmentHit).length, denominator: mustAugment.length },
    criticalSafetyCounts: Object.fromEntries(gates.map((gate) => [gate, count(results, (item) => item.safetyViolations.includes(gate))])),
    malformedCount: count(results, (item) => !item.structuredParse),
    rejectedCount: count(results, (item) => !item.accepted),
    categoryCounts: Object.fromEntries([...new Set(results.flatMap((item) => item.tags))].sort().map((tag) => [tag, count(results, (item) => item.tags.includes(tag))])),
    totals,
    policyDigests: [...new Set(results.flatMap((item) => item.policyDigest ? [item.policyDigest] : []))],
    schemaDigests: [...new Set(results.flatMap((item) => item.schemaDigest ? [item.schemaDigest] : []))],
    failedCaseIds: results.filter((item) => !item.accepted || item.mismatches.length || item.safetyViolations.length).map((item) => item.caseId),
    resultDigest: persistedAuditDigest(results),
  };
}

export const SEMANTIC_PROFILES_V2 = { core: ALPHA_CORE_P4, augment: ALPHA_AUGMENT_CANDIDATE_P4 } as const;
