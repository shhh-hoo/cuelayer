import { describe, expect, it } from "vitest";
import { BOUNDED_CONTEXT_POLICY, projectBoundedHistory } from "./bounded-context";
import { buildTeachingInterpretationRequest, projectProcessedTimeline } from "./context-projection";
import { LessonStreamRuntime } from "./runtime";
import { LosslessInterpretationScheduler } from "./pending-evidence";
import { nextTeachingRequest } from "./scheduled-request";
import { createInitialTeachingState } from "./teaching-state";
import { replayLessonEvents } from "./replay";
import { ALPHA_CONTINUOUS_P4 } from "./semantic-profile";
import { teachingProviderContract } from "../../server/teaching/provider-contract";
import type { LessonEvent, ProcessedTimelineEntry, ContextProjectionDiagnostics } from "./contracts";

const ref = (checkpointId: string) => ({ checkpointId, quote: `Synthetic ${checkpointId}.` });
const contribution = (id: string) => ({ mode: "REPRESENT" as const, content: { kind: "TEXT" as const, text: `Synthetic ${id}.` }, provenance: { basis: "SPEECH" as const, speechRefs: [ref(id)] } });
const evidence = (n: number, text = `Synthetic ${n}.`): ProcessedTimelineEntry => ({ type: "evidence", checkpointId: `e${n}`, sequence: n, text, warnings: [] });
const journal = (n: number): Extract<ProcessedTimelineEntry, { type: "accepted_interpretation" }> => ({ type: "accepted_interpretation", interpretationId: `j${n}`, contributionIds: { board: `b${n}` }, consumesCheckpointIds: [`e${n}`], boardDelta: { action: "SET_ACTIVE", continuity: "same_thread", retainPrevious: false, contribution: contribution(`e${n}`) }, cueDelta: { action: "KEEP" }, resultingBoardRevision: n, resultingCueRevision: 0 });
const full = (n: number) => Array.from({ length: n }, (_, i) => [evidence(i), journal(i)]).flat();
const ids = (history: ProcessedTimelineEntry[]) => history.flatMap(e => e.type === "evidence" ? [e.checkpointId] : []);

describe("versioned bounded projection, synthetic offline fixtures", () => {
  it("bounds increasing history, keeps recent text, and never mutates the lossless history/state", () => {
    const history = full(300), state = createInitialTeachingState(), original = structuredClone(history);
    const result = projectBoundedHistory(history, state, ["future"]);
    expect(result.diagnostics.blockedReason).toBeUndefined();
    expect(result.diagnostics.estimatedHistoryTokens).toBeLessThanOrEqual(BOUNDED_CONTEXT_POLICY.historyTokenBudget);
    expect(ids(result.history)).toContain("e299"); expect(ids(result.history)).not.toContain("e0");
    expect(ids(result.history)).not.toContain("future");
    expect(result.diagnostics.omittedEvidenceCount).toBeGreaterThan(200);
    expect(projectBoundedHistory(history, state, ["future"])).toEqual(result);
    expect(history).toEqual(original); expect(state).toEqual(createInitialTeachingState());
  });
  it("pins current Cue and hint plus transitive Board attribution outside the recent window", () => {
    const state = createInitialTeachingState();
    state.board.active = { id: "b2", sourceCheckpointIds: ["e2"], establishedAtRevision: 1, contribution: { ...contribution("e2"), provenance: { basis: "SPEECH_AND_STATE", speechRefs: [ref("e2")], stateRefs: [{ kind: "BOARD_ITEM", id: "b0" }] } } };
    state.cue.active = { id: "cue", kind: "QUESTION", activatedAt: 1, sourceSegmentIds: ["e3"], contribution: { ...contribution("e3"), content: "Synthetic question?" }, hint: { sourceCheckpointIds: ["e4"], contribution: { ...contribution("e4"), content: "Synthetic hint." } } };
    const result = projectBoundedHistory(full(200), state, []);
    expect(result.diagnostics.blockedReason).toBeUndefined();
    expect(ids(result.history)).toEqual(expect.arrayContaining(["e0", "e2", "e3", "e4"]));
    expect(result.history).toContainEqual(journal(0));
    expect(result.history.find(e => e.type === "evidence" && e.checkpointId === "e0")).toEqual(evidence(0));
  });
  it.each(["missing", "oversize"])("blocks %s mandatory grounding instead of silently removing it", kind => {
    const state = createInitialTeachingState();
    state.board.active = { id: "b0", sourceCheckpointIds: ["e0"], establishedAtRevision: 1, contribution: contribution("e0") };
    const result = projectBoundedHistory(kind === "missing" ? [] : [evidence(0, "x".repeat(20_000))], state, []);
    expect(result.diagnostics.blockedReason).toBe(kind === "missing" ? "context-required-reference-missing" : "context-required-history-budget-exceeded");
    if (kind === "oversize") expect(ids(result.history)).toEqual(["e0"]);
  });
  it("keeps bounded unfinished carryover outside the speech suffix and releases attributed fragments", () => {
    const history = full(30);
    for (const entry of history) {
      if (entry.type === "evidence") entry.text = "synthetic words ".repeat(60);
      else if (entry.interpretationId === "j10" || entry.interpretationId === "j11") entry.boardDelta = { action: "KEEP", reason: "unfinished" };
    }
    const result = projectBoundedHistory(history, createInitialTeachingState(), []);
    expect(result.diagnostics.retainedIncompleteIds).toEqual(expect.arrayContaining(["e10", "e11"]));
    const last = history.at(-1)! as ReturnType<typeof journal>;
    if (last.boardDelta.action !== "SET_ACTIVE") throw Error("fixture");
    last.boardDelta.contribution.provenance.speechRefs!.push(ref("e10"));
    const after = projectBoundedHistory(history, createInitialTeachingState(), []);
    expect(after.diagnostics.retainedIncompleteIds).not.toContain("e10");
    expect(after.diagnostics.retainedIncompleteIds).toContain("e11");
  });
  it("never includes an interpretation without its consumed evidence and attribution dependencies", () => {
    const result = projectBoundedHistory(full(60), createInitialTeachingState(), []);
    const selected = new Set(ids(result.history));
    for (const entry of result.history) if (entry.type === "accepted_interpretation") expect(entry.consumesCheckpointIds.every(id => selected.has(id))).toBe(true);
  });
  it("keeps the old P4 history policy available alongside the separately versioned compact wire schema", () => {
    expect(teachingProviderContract(ALPHA_CONTINUOUS_P4).text.format.name).toBe("teaching_interpretation_v8_1");
    expect(teachingProviderContract().text.format.name).toBe("teaching_interpretation_compact_v1");
    const events: LessonEvent[] = [];
    const result = buildTeachingInterpretationRequest({ requestId: "old", sessionId: "test", currentState: createInitialTeachingState(), events, newEvidence: [{ checkpointId: "new", lessonSequence: 1, speechRunId: 1, startMs: 0, endMs: 1, text: "Synthetic", sourceFinalIds: [], warnings: [] }], profile: ALPHA_CONTINUOUS_P4 });
    expect(result.diagnostics.contextProjection).toBeUndefined();
    expect(result.request.processedTimeline).toEqual(projectProcessedTimeline(events));
  });
  it("reports a blocked preview without consuming or starting a request", () => {
    const cp = { checkpointId: "pending", lessonSequence: 1, speechRunId: 1, startMs: 0, endMs: 1, text: "Synthetic pending", sourceFinalIds: [], warnings: [] };
    const state = createInitialTeachingState();
    state.board.active = { id: "board", sourceCheckpointIds: ["missing"], establishedAtRevision: 1, contribution: contribution("missing") };
    const scheduler = new LosslessInterpretationScheduler(); scheduler.enqueue([cp]);
    const runtime = { events: [], state } as unknown as LessonStreamRuntime;
    let blocked: ContextProjectionDiagnostics | undefined;
    expect(nextTeachingRequest(runtime, scheduler, 1, "synthetic", 100, d => { blocked = d; })).toBeUndefined();
    expect(blocked?.contextProjection?.blockedReason).toBe("context-required-reference-missing");
    expect(scheduler.pendingCheckpoints).toEqual([cp]); expect(scheduler.currentWork).toBeUndefined();
  });
  it("drains 240 checkpoints via production scheduling/validation/reducer; old omitted refs stay invalid", async () => {
    const events: LessonEvent[] = [];
    const runtime = await LessonStreamRuntime.open("synthetic-long", { readSession: async () => [], append: async items => { events.push(...items); } });
    await runtime.start(); const scheduler = new LosslessInterpretationScheduler(); let maximum = 0;
    for (let n = 0; n < 240; n++) {
      const cp = (await runtime.commitClosedSpan({ id: `s${n}`, revision: 1, text: `Synthetic teaching point ${n}.`, sourceFinalIds: [`f${n}`], words: [], startMs: n * 1000, endMs: n * 1000 + 900, openedAtMs: n * 1000, updatedAtMs: n * 1000 + 900, status: "closed", closeReason: "explicit_stop" }, 1))!;
      scheduler.enqueue([cp]); const scheduled = nextTeachingRequest(runtime, scheduler, 1, runtime.sessionId)!;
      expect(scheduled).toBeDefined(); expect(scheduler.isBudgetBlocked).toBe(false);
      const { request, work, diagnostics } = scheduled; maximum = Math.max(maximum, diagnostics.projectedInputTokens);
      const proposal = { requestId: request.requestId, baseBoardRevision: request.currentState.board.revision, baseCueRevision: request.currentState.cue.revision, steps: [{ consumesCheckpointIds: [cp.checkpointId], boardDelta: { action: "SET_ACTIVE", continuity: "same_thread", retainPrevious: false, contribution: contribution(cp.checkpointId) }, cueDelta: { action: "KEEP" }, evidenceRefs: [ref(cp.checkpointId)] }] };
      if (n === 239) {
        const old = events.find(e => e.type === "evidence.checkpoint_committed"); if (old?.type !== "evidence.checkpoint_committed") throw Error("fixture");
        const invalid = structuredClone(proposal); invalid.steps[0]!.boardDelta.contribution.provenance.speechRefs = [ref(old.checkpoint.checkpointId)];
        expect((await runtime.acceptProposal({ request, proposal: invalid, model: "synthetic" })).ok).toBe(false);
        expect(runtime.pending.map(c => c.checkpointId)).toEqual([cp.checkpointId]);
      }
      const accepted = await runtime.acceptProposal({ request, proposal, model: "synthetic" });
      expect(accepted.ok).toBe(true); if (!accepted.ok) throw Error(accepted.error);
      scheduler.settleAccepted(work.requestId, accepted.steps.flatMap(s => s.consumesCheckpointIds));
    }
    expect(runtime.pending).toEqual([]); expect(runtime.replay.consumedCheckpointIds.size).toBe(240);
    expect(replayLessonEvents(events).state).toEqual(runtime.state);
    expect(maximum).toBeLessThan(9_952); runtime.close();
  });
});
