import type { ProcessedTimelineEntry, TeachingStateSnapshot } from "./contracts.ts";

/** Projection only: the immutable event log and authoritative state are never trimmed. */
export const BOUNDED_CONTEXT_POLICY = Object.freeze({
  version: "bounded-evidence-v1",
  historyTokenBudget: 4_000,
  recentSpeechTokenBudget: 1_600,
  recentInterpretations: 4,
  incompleteLookbackCheckpoints: 24,
  incompleteCheckpointLimit: 8,
  tokenEstimate: "ceil-json-characters-divided-by-four",
} as const);
export const estimateContextTokens = (value: unknown) => Math.ceil(JSON.stringify(value).length / 4);

/** References are kept with their immutable source text; IDs alone are not grounding. */
function references(value: unknown, speech: Set<string>, state: Set<string>) {
  if (Array.isArray(value)) { for (const item of value) references(item, speech, state); return; }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (typeof record.checkpointId === "string") speech.add(record.checkpointId);
  if ((record.kind === "BOARD_ITEM" || record.kind === "ACTIVE_CUE") && typeof record.id === "string") state.add(record.id);
  for (const key of ["consumesCheckpointIds", "sourceCheckpointIds", "sourceSegmentIds"]) {
    if (Array.isArray(record[key])) for (const id of record[key]) if (typeof id === "string") speech.add(id);
  }
  for (const key of ["targetBoardItemId", "targetCueId"]) if (typeof record[key] === "string") state.add(record[key]);
  if (Array.isArray(record.invalidatesBoardItemIds)) for (const id of record.invalidatesBoardItemIds) if (typeof id === "string") state.add(id);
  for (const item of Object.values(record)) references(item, speech, state);
}

export function projectBoundedHistory(full: ProcessedTimelineEntry[], currentState: TeachingStateSnapshot, newEvidenceIds: readonly string[]) {
  const policy = BOUNDED_CONTEXT_POLICY;
  const evidence = new Map<string, number>(), contributions = new Map<string, number>();
  const evidenceIndexes: number[] = [], journalIndexes: number[] = [];
  full.forEach((entry, index) => {
    if (entry.type === "evidence") { evidence.set(entry.checkpointId, index); evidenceIndexes.push(index); }
    else {
      journalIndexes.push(index);
      for (const id of Object.values(entry.contributionIds)) if (id) contributions.set(id, index);
    }
  });
  const currentIds = new Set(newEvidenceIds);
  // Each closure includes the source text and historical attribution of referenced contributions.
  const closure = (initial: Iterable<number>, speech: Set<string> = new Set(), state: Set<string> = new Set()) => {
    const selected = new Set(initial), visited = new Set<number>(), visitedState = new Set<string>(), missing = new Set<string>();
    for (;;) {
      for (const id of speech) {
        const index = evidence.get(id);
        if (index !== undefined) selected.add(index);
        else if (!currentIds.has(id)) missing.add(id);
      }
      for (const id of state) {
        if (visitedState.has(id)) continue;
        visitedState.add(id);
        const index = contributions.get(id);
        if (index !== undefined) selected.add(index);
        else missing.add(id);
      }
      const next = [...selected].filter(index => !visited.has(index));
      if (!next.length) break;
      for (const index of next) { visited.add(index); references(full[index], speech, state); }
    }
    return { selected, missing: [...missing] };
  };
  const materialize = (selected: Set<number>) => full.filter((_, index) => selected.has(index));
  const tokens = (selected: Set<number>) => estimateContextTokens(materialize(selected));
  const rootSpeech = new Set<string>(), rootState = new Set<string>();
  references(currentState, rootSpeech, rootState);
  const mandatory = closure([], rootSpeech, rootState);
  const mandatoryTokens = tokens(mandatory.selected);
  const blockedReason = mandatory.missing.length ? "context-required-reference-missing"
    : mandatoryTokens > policy.historyTokenBudget ? "context-required-history-budget-exceeded" : undefined;
  let selected = mandatory.selected;
  const add = (indexes: number[]) => {
    const candidate = closure([...selected, ...indexes]);
    if (candidate.missing.length || tokens(candidate.selected) > policy.historyTokenBudget) return false;
    selected = candidate.selected; return true;
  };
  const retainedIncompleteIds: string[] = [];
  if (!blockedReason) {
    let recentTokens = 0;
    for (const index of [...evidenceIndexes].reverse()) {
      const cost = estimateContextTokens(full[index]);
      if (recentTokens + cost > policy.recentSpeechTokenBudget || !add([index])) break;
      recentTokens += cost;
    }
    // Bounded carryover, not a claim to track every unresolved semantic thread.
    // A later accepted contribution citing the fragment discharges this extra retention.
    const attributed = new Set<string>(), recentIds = new Set(evidenceIndexes.slice(-policy.incompleteLookbackCheckpoints).map(index => (full[index] as Extract<ProcessedTimelineEntry, { type: "evidence" }>).checkpointId));
    for (const index of [...journalIndexes].reverse()) {
      const entry = full[index] as Extract<ProcessedTimelineEntry, { type: "accepted_interpretation" }>;
      if (entry.boardDelta.action === "KEEP" && ["unfinished", "ambiguous_reference", "insufficient_evidence"].includes(entry.boardDelta.reason)) {
        for (const id of [...entry.consumesCheckpointIds].reverse()) {
          if (retainedIncompleteIds.length >= policy.incompleteCheckpointLimit) break;
          if (recentIds.has(id) && !attributed.has(id) && evidence.has(id) && add([evidence.get(id)!])) retainedIncompleteIds.push(id);
        }
      }
      references([entry.boardDelta, entry.cueDelta], attributed, new Set());
    }
    for (const index of journalIndexes.slice(-policy.recentInterpretations).reverse()) add([index]);
  }
  const history = materialize(selected);
  return { history, diagnostics: {
    version: policy.version,
    historyTokenBudget: policy.historyTokenBudget,
    estimatedHistoryTokens: estimateContextTokens(history),
    mandatoryHistoryTokens: mandatoryTokens,
    pinnedEvidenceIds: [...rootSpeech],
    selectedEvidenceIds: history.flatMap(entry => entry.type === "evidence" ? [entry.checkpointId] : []),
    selectedInterpretationIds: history.flatMap(entry => entry.type === "accepted_interpretation" ? [entry.interpretationId] : []),
    omittedEvidenceCount: evidence.size - history.filter(entry => entry.type === "evidence").length,
    omittedInterpretationCount: journalIndexes.length - history.filter(entry => entry.type === "accepted_interpretation").length,
    retainedIncompleteIds,
    incompleteRetentionScope: `last ${policy.incompleteLookbackCheckpoints} consumed checkpoints; at most ${policy.incompleteCheckpointLimit}; no all-thread completeness claim`,
    missingRequiredReferenceIds: mandatory.missing,
    ...(blockedReason ? { blockedReason } : {}),
  } };
}
