import { traceDraft, type SessionTraceDraft } from "./contracts";

/** Browser monotonic clock expressed as an epoch, never a provider/server timestamp. */
export const latencyNow = () => performance.timeOrigin + performance.now();
export type SpeechLatency = { asrFinalAt: number; speechEndMs: number | null; speechObservedAt: number | null; speechMappingUncertaintyMs: number | null; speechClockBasis: "pcm-delivery-observation" | "unavailable" };
export type LatencyStage = {
  stage: "committed" | "eligible" | "started" | "provider" | "timeout" | "validation" | "reduced" | "failed";
  checkpointIds: string[]; at: number; requestId?: string; runId?: string | number;
  sourceFinalIds?: string[]; speechEndMs?: number; checkpointClosedAt?: number;
  pendingCount?: number; oldestPendingAgeMs?: number; batchSize?: number;
  validationStatus?: string; stateChanged?: boolean; boardRevision?: number; cueRevision?: number;
  providerDurationMs?: number; providerTimingScope?: "server-sdk" | "browser-roundtrip";
};
export type LearnerLatencyRecord = {
  checkpointId: string; runId?: string | number; requestId?: string; sourceFinalIds: string[];
  speechEndMs: number | null; speechObservedAt: number | null; speechClockBasis: string; speechMappingUncertaintyMs: number | null;
  asrFinalAt: number | null; checkpointClosedAt: number | null; checkpointCommittedAt: number | null;
  plannerEligibleAt: number | null; plannerStartedAt: number | null; providerFinishedAt: number | null; timeoutAt: number | null;
  validationAt: number | null; proposalAcceptedAt: number | null; stateReducedAt: number | null; rendererCommittedAt: number | null; domVisibleAt: number | null;
  pendingCount: number | null; oldestPendingAgeMs: number | null; batchSize: number | null; retryAttempt: number;
  providerDurationMs: number | null; providerTimingScope: string; stateChanged?: boolean; boardRevision?: number; cueRevision?: number;
  attemptCountScope: "observed-checkpoint-dispatches-in-this-page"; status: string; domObservation?: string; renderTargets?: string[]; removedTargets?: string[];
};
function empty(id: string): LearnerLatencyRecord {
  return { checkpointId: id, sourceFinalIds: [], speechEndMs: null, speechObservedAt: null, speechClockBasis: "unavailable", speechMappingUncertaintyMs: null, asrFinalAt: null, checkpointClosedAt: null, checkpointCommittedAt: null, plannerEligibleAt: null, plannerStartedAt: null, providerFinishedAt: null, timeoutAt: null, validationAt: null, proposalAcceptedAt: null, stateReducedAt: null, rendererCommittedAt: null, domVisibleAt: null, pendingCount: null, oldestPendingAgeMs: null, batchSize: null, retryAttempt: 0, providerDurationMs: null, providerTimingScope: "unavailable", attemptCountScope: "observed-checkpoint-dispatches-in-this-page", status: "unavailable" };
}
const difference = (end: number | null, start: number | null) => end !== null && start !== null && end >= start ? end - start : null;
export function latencyDerived(r: LearnerLatencyRecord) {
  return { speechToAsrMs: difference(r.asrFinalAt, r.speechObservedAt), asrToCommitMs: difference(r.checkpointCommittedAt, r.asrFinalAt), commitToPlannerStartMs: difference(r.plannerStartedAt, r.checkpointCommittedAt), providerMs: r.providerDurationMs ?? difference(r.providerFinishedAt ?? r.timeoutAt, r.plannerStartedAt), providerToStateMs: difference(r.stateReducedAt, r.providerFinishedAt), stateToDomMs: difference(r.domVisibleAt, r.stateReducedAt), speechToDomMs: difference(r.domVisibleAt, r.speechObservedAt) };
}

/** Pure, bounded correlation observer. Never runs scheduler, persistence or semantic work. */
export class LearnerLatencyTracker {
  private records = new Map<string, LearnerLatencyRecord>();
  private speech = new Map<string, SpeechLatency>();
  private finals = new Map<string, SpeechLatency>();
  constructor(private readonly capacity = 256) {}
  get size() { return this.records.size; }
  private put<T>(map: Map<string, T>, key: string, value: T) {
    map.set(key, value); if (map.size > this.capacity) map.delete(map.keys().next().value!);
  }
  observe(draft: SessionTraceDraft): SessionTraceDraft[] {
    const out: SessionTraceDraft[] = [];
    if (draft.type === "speech.final_received" && draft.payload.latency && draft.correlation?.speechEventId) this.put(this.speech, draft.correlation.speechEventId, draft.payload.latency);
    if (draft.type === "canonical.final_committed" && draft.payload.speechEventId) {
      const timing = this.speech.get(draft.payload.speechEventId);
      if (timing) this.put(this.finals, `${draft.payload.runId}:${draft.payload.finalId}`, timing);
    }
    if (draft.type === "latency.stage") {
      const p = draft.payload;
      for (const id of p.checkpointIds) {
        let r = this.records.get(id);
        if (!r) {
          if (this.records.size >= this.capacity) out.push(traceDraft("latency.gap", { reason: "correlation_capacity", checkpointId: this.records.keys().next().value! }));
          r = empty(id); this.put(this.records, id, r);
        }
        r.status = p.stage;
        if (p.runId !== undefined && (p.stage === "committed" || r.runId === undefined)) r.runId = p.runId;
        if (p.requestId) r.requestId = p.requestId;
        for (const key of ["pendingCount", "oldestPendingAgeMs", "batchSize", "boardRevision", "cueRevision", "stateChanged"] as const) if (p[key] !== undefined) Object.assign(r, { [key]: p[key] });
        if (p.stage === "committed") { r.sourceFinalIds = p.sourceFinalIds ?? []; r.speechEndMs = p.speechEndMs ?? null; r.checkpointClosedAt = p.checkpointClosedAt ?? null; r.checkpointCommittedAt = p.at; }
        if (p.stage === "eligible") r.plannerEligibleAt ??= p.at;
        if (p.stage === "started") { r.retryAttempt++; r.plannerStartedAt = p.at; r.providerFinishedAt = r.timeoutAt = null; r.providerDurationMs = null; r.providerTimingScope = "browser-roundtrip"; }
        if (p.stage === "provider" || p.stage === "timeout") { if (p.stage === "timeout") r.timeoutAt = p.at; else r.providerFinishedAt = p.at; r.providerDurationMs = p.providerDurationMs ?? null; r.providerTimingScope = p.providerTimingScope ?? "browser-roundtrip"; }
        if (p.stage === "validation") r.validationAt = p.at;
        if (p.stage === "reduced") { r.proposalAcceptedAt = p.at; r.stateReducedAt = p.at; }
        if (p.stage === "failed" && p.providerDurationMs !== undefined) { r.providerDurationMs = p.providerDurationMs; r.providerTimingScope = p.providerTimingScope ?? "server-sdk"; }
        this.hydrate(r);
        out.push(this.snapshot(r));
      }
    }
    if (draft.type === "interpretation.step_accepted") {
      const p = draft.payload;
      for (const id of p.checkpointIds) {
        const r = this.records.get(id); if (!r) continue;
        r.boardRevision = p.stateAfter.board.revision; r.cueRevision = p.stateAfter.cue.revision;
        const before = p.stateBefore; const after = p.stateAfter;
        const ids = (state: typeof before) => [state.board.active?.id, ...state.board.retained.map(item => item.id), ...state.board.support.map(item => item.id), state.cue.active?.id, state.cue.active?.hint ? `${state.cue.active.id}:hint` : undefined].filter((id): id is string => !!id);
        const beforeIds = new Set(ids(before)); const afterIds = new Set(ids(after));
        r.renderTargets = [...afterIds].filter(id => !beforeIds.has(id));
        // A hint/replacement can change content while retaining its owning Cue ID.
        if (before.cue.revision !== after.cue.revision && after.cue.active) {
          r.renderTargets.push(after.cue.active.id);
          if (after.cue.active.hint) r.renderTargets.push(`${after.cue.active.id}:hint`);
        }
        if (before.board.active?.id !== after.board.active?.id && after.board.active) r.renderTargets.push(after.board.active.id);
        r.renderTargets = [...new Set(r.renderTargets)];
        r.removedTargets = [...beforeIds].filter(id => !afterIds.has(id));
        r.stateChanged = p.stateBefore.board.revision !== p.stateAfter.board.revision || p.stateBefore.cue.revision !== p.stateAfter.cue.revision;
      }
    }
    if (draft.type === "teaching_surface.visibility") {
      const p = draft.payload;
      for (const r of this.records.values()) {
        if (r.stateReducedAt === null || r.domVisibleAt !== null || r.domObservation) continue;
        // A superseded intermediate state must never receive the later render's timestamp.
        const exact = r.boardRevision === p.boardRevision && r.cueRevision === p.cueRevision;
        if (!exact && !(p.boardRevision >= (r.boardRevision ?? Infinity) && p.cueRevision >= (r.cueRevision ?? Infinity))) continue;
        let observation = p.observation;
        let visibleAt = p.domVisibleAt;
        if (p.items && !r.renderTargets) { observation = "unavailable"; visibleAt = null; }
        if (p.items && r.renderTargets && exact && p.observation !== "unavailable") {
          const items = new Map(p.items.map(item => [item.id, item.observation]));
          const affected = r.renderTargets.map(id => items.get(id) ?? "unavailable");
          const removed = r.removedTargets ?? [];
          const hasChange = affected.length > 0 || removed.length > 0;
          observation = p.documentVisible === false ? "hidden" : affected.find(value => value !== "visible") ?? (removed.some(id => items.has(id)) || !hasChange ? "unavailable" : "visible");
          visibleAt = observation === "visible" ? p.observedAt ?? null : null;
        }
        r.domObservation = r.stateChanged === false ? "no_surface_change" : exact ? observation : "superseded_before_observation";
        if (exact) { r.rendererCommittedAt = p.rendererCommittedAt; if (observation === "visible" && r.stateChanged !== false) r.domVisibleAt = visibleAt; }
        this.hydrate(r); out.push(this.snapshot(r));
      }
    }
    return out;
  }
  private hydrate(r: LearnerLatencyRecord) {
    const values = r.sourceFinalIds.map(id => this.finals.get(`${r.runId}:${id}`));
    if (!values.length || values.some(v => !v)) return;
    r.asrFinalAt = Math.max(...values.map(v => v!.asrFinalAt));
    const end = values.find(v => v!.speechEndMs === r.speechEndMs);
    if (end) { r.speechObservedAt = end.speechObservedAt; r.speechClockBasis = end.speechClockBasis; r.speechMappingUncertaintyMs = end.speechMappingUncertaintyMs; }
  }
  private snapshot(r: LearnerLatencyRecord) {
    return traceDraft("latency.checkpoint", { ...r, sourceFinalIds: [...r.sourceFinalIds], derived: latencyDerived(r), clock: "browser-performance-epoch", unavailable: "null; no inferred completion or physical display time" }, { occurredAt: latencyNow(), correlation: { checkpointId: r.checkpointId, runId: r.runId, plannerRequestId: r.requestId } });
  }
}
