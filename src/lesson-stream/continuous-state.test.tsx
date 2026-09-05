import { describe, expect, it, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TeachingSurfaceLayer } from "../session/TeachingSurfaceLayer";
import { LessonStreamRuntime, type LessonEventStore } from "./runtime";
import { buildTeachingInterpretationRequest } from "./context-projection";
import { validateAndNormalizeProposal } from "./accepted-interpretations";
import { createTeachingInterpretationSchema, normalizeTeachingProposal, suppliedSpeechCheckpointIds, teachingResponseRequest } from "../../server/teaching/provider-contract";
import { ACTIVE_ALPHA_SEMANTIC_PROFILE } from "./semantic-profile";
import { LosslessInterpretationScheduler } from "./pending-evidence";
import { RetryBackoff } from "../session/retry-backoff";
import { interpretationDeadlines, classifyInterpretationFailure } from "./runtime-policy";
import { replayLessonEvents } from "./replay";
import type { BoardDelta, TeachingCueDelta, LessonEvent, TeachingInterpretationRequest, CompactEvidenceCheckpoint } from "./contracts";

const ref = (id: string) => ({ checkpointId: id, quote: "untrusted provider quote" });
const contribution = <T,>(content: T, ids: string[]) => ({ mode: "REPRESENT" as const, content, provenance: { basis: "SPEECH" as const, speechRefs: ids.map(ref) } });
const board = (text: string, ids: string[], retainPrevious = false): BoardDelta => ({ action: "SET_ACTIVE", continuity: "same_thread", retainPrevious, contribution: contribution({ kind: "TEXT", text }, ids) });
const keep: BoardDelta = { action: "KEEP", reason: "unfinished" };
async function lesson() {
  const events: LessonEvent[] = [];
  const store: LessonEventStore = { append: async (items) => { events.push(...items); }, readSession: async () => [...events] };
  const runtime = await LessonStreamRuntime.open("continuous", store);
  await runtime.start();
  let n = 0;
  async function speech(text: string) {
    const index = ++n;
    return (await runtime.commitClosedSpan({ id: `span-${index}`, revision: 1, text, sourceFinalIds: [`final-${index}`], words: [], startMs: index * 1000, endMs: index * 1000 + 500, openedAtMs: 0, updatedAtMs: 0, status: "closed", closeReason: "terminal_punctuation" }, "run"))!;
  }
  function request() { return buildTeachingInterpretationRequest({ requestId: `request-${n}`, sessionId: "continuous", events, currentState: runtime.state, newEvidence: runtime.pending }).request; }
  async function accept(boardDelta: BoardDelta = keep, cueDelta: TeachingCueDelta = { action: "KEEP" }) {
    const input = request();
    const result = await runtime.acceptProposal({ request: input, model: "deterministic", proposal: proposal(input, boardDelta, cueDelta) });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    return result;
  }
  const html = () => renderToStaticMarkup(<TeachingSurfaceLayer state={runtime.state} presentationMode="presentationless" />);
  return { runtime, speech, request, accept, html, events, store };
}
function proposal(input: TeachingInterpretationRequest, boardDelta: BoardDelta, cueDelta: TeachingCueDelta = { action: "KEEP" }) {
  return { requestId: input.requestId, baseBoardRevision: input.currentState.board.revision, baseCueRevision: input.currentState.cue.revision, steps: [{ consumesCheckpointIds: input.newEvidence.map((item) => item.checkpointId), boardDelta, cueDelta, evidenceRefs: [ref(input.newEvidence.at(-1)!.checkpointId)] }] };
}

describe("continuous learner-visible state", () => {
  it.each([
    ["Activation energy is the minimum energy required for a reaction."],
    ["Activation energy is the minimum", "energy required for a reaction."],
    ["Activation energy is", "the minimum energy required", "for a reaction."],
  ])("reconstructs a definition with exactly the required canonical fragments: %j", async (...parts: string[]) => {
    const l = await lesson(); const ids: string[] = [];
    for (const [index, text] of parts.entries()) {
      ids.push((await l.speech(text)).checkpointId);
      if (index < parts.length - 1) { await l.accept(); expect(l.html()).toBe(""); }
    }
    const input = l.request();
    const raw = JSON.parse(JSON.stringify(proposal(input, board("Activation energy is the minimum energy required for a reaction.", ids))));
    raw.warnings = null;
    raw.steps[0].warnings = null;
    raw.steps[0].boardDelta.support = null;
    raw.steps[0].boardDelta.invalidatesBoardItemIds = null;
    raw.steps[0].boardDelta.contribution.provenance.stateRefs = null;
    raw.steps[0].boardDelta.contribution.provenance.speechRefs = ids.map((checkpointId) => ({ checkpointId }));
    raw.steps[0].evidenceRefs = [{ checkpointId: ids.at(-1) }];
    const parsed = createTeachingInterpretationSchema(ACTIVE_ALPHA_SEMANTIC_PROFILE, input.newEvidence.map((item) => item.checkpointId), suppliedSpeechCheckpointIds(input)).parse(raw);
    const normalized = normalizeTeachingProposal(parsed, input);
    const accepted = await l.runtime.acceptProposal({ proposal: normalized, request: input, model: "test" });
    expect(accepted.ok).toBe(true);
    expect(l.html()).toContain("Activation energy is the minimum energy required for a reaction.");
    expect(l.runtime.state.board.active?.contribution.provenance.speechRefs).toEqual(ids.map((checkpointId, i) => ({ checkpointId, quote: parts[i] })));
    expect(l.runtime.pending).toEqual([]);
    expect(l.runtime.replay.consumedCheckpointIds.size).toBe(parts.length);
    expect(replayLessonEvents(l.events).state).toEqual(l.runtime.state);
  });

  it("uses a stable v8.1 provider schema while validation rejects invented IDs", async () => {
    const l = await lesson(); const a = await l.speech("First point."); const first = l.request();
    const format = teachingResponseRequest(first).text.format;
    await l.accept(board(a.text, [a.checkpointId]));
    await l.speech("Second point."); const next = l.request();
    expect(teachingResponseRequest(next).text.format).toEqual(format);
    expect((await l.runtime.acceptProposal({ request: next, proposal: proposal(next, board("Invented point", ["not-provided"])), model: "test" })).ok).toBe(false);
  });

  it("keeps a complete Board through filler and arbitrarily long silence", async () => {
    const l = await lesson(); const a = await l.speech("Energy is conserved."); await l.accept(board(a.text, [a.checkpointId]));
    const before = l.html(); const revision = l.runtime.state.board.revision;
    await l.speech("Okay, um, right."); await l.accept({ action: "KEEP", reason: "filler" });
    expect(l.html()).toBe(before);
    vi.useFakeTimers(); vi.advanceTimersByTime(60 * 60 * 1000); vi.useRealTimers();
    expect(l.runtime.state.board.revision).toBe(revision); expect(l.html()).toBe(before);
  });

  it("follows same-topic focal shifts and renders Support only under the actual owner", async () => {
    const l = await lesson(); const a = await l.speech("Activation energy is a threshold."); await l.accept(board(a.text, [a.checkpointId]));
    const owner = l.runtime.state.board.active!.id;
    const b = await l.speech("Picture a hill."); await l.accept({ action: "ADD_SUPPORT", targetBoardItemId: owner, support: contribution(b.text, [b.checkpointId]) });
    const c = await l.speech("Now focus on collision frequency, still in reaction rates."); await l.accept(board("Collision frequency", [c.checkpointId], true));
    expect(l.runtime.state.board.active?.contribution.content).toEqual({ kind: "TEXT", text: "Collision frequency" });
    expect(l.runtime.state.board.retained[0]?.id).toBe(owner);
    const html = l.html();
    expect(html).toContain(`data-support-target="${owner}">Picture a hill.`);
    expect(html.indexOf("Picture a hill.")).toBeLessThan(html.indexOf('class="board-layout-active"'));
  });

  it.each(["retain", "discard"] as const)("retires Active without replacement (%s) and never orphans Support", async (disposition) => {
    const l = await lesson(); const a = await l.speech("Energy threshold."); await l.accept(board(a.text, [a.checkpointId]));
    const id = l.runtime.state.board.active!.id;
    const b = await l.speech("Think of a hill."); await l.accept({ action: "ADD_SUPPORT", targetBoardItemId: id, support: contribution(b.text, [b.checkpointId]) });
    await l.speech("We are finished with this point. Move on.");
    await l.accept({ action: "RETIRE_ACTIVE", targetBoardItemId: id, disposition, reason: "teacher_moved_on" });
    expect(l.runtime.state.board.active).toBeUndefined();
    expect(l.runtime.state.board.retained).toHaveLength(disposition === "retain" ? 1 : 0);
    expect(l.runtime.state.board.support).toHaveLength(disposition === "retain" ? 1 : 0);
    if (disposition === "retain") expect(l.html()).toContain("Energy threshold."); else expect(l.html()).toBe("");
    expect(replayLessonEvents(l.events).state).toEqual(l.runtime.state);
  });

  it("rejects retirement of a non-Active target or history-only trigger", async () => {
    const l = await lesson(); const a = await l.speech("First point."); await l.accept(board(a.text, [a.checkpointId]));
    const active = l.runtime.state.board.active!.id;
    await l.speech("Leave this point."); const input = l.request();
    for (const invalid of [proposal(input, { action: "RETIRE_ACTIVE", targetBoardItemId: "missing", disposition: "discard", reason: "completed" }), { ...proposal(input, { action: "RETIRE_ACTIVE", targetBoardItemId: active, disposition: "discard", reason: "completed" }), steps: [{ ...proposal(input, keep).steps[0]!, boardDelta: { action: "RETIRE_ACTIVE" as const, targetBoardItemId: active, disposition: "discard" as const, reason: "completed" as const }, evidenceRefs: [ref(a.checkpointId)] }] }]) {
      expect((await l.runtime.acceptProposal({ proposal: invalid, request: input, model: "test" })).ok).toBe(false);
    }
    expect(l.runtime.state.board.active?.id).toBe(active); expect(l.runtime.pending).toHaveLength(1);
  });

  it("third optional Support cannot erase truth-critical qualifiers in the proposition", async () => {
    const l = await lesson(); const a = await l.speech("Only collisions with sufficient energy and the correct orientation may react."); await l.accept(board(a.text, [a.checkpointId]));
    for (const text of ["Picture a hill.", "Draw two particles.", "Use arrows for motion."]) {
      const b = await l.speech(text); await l.accept({ action: "ADD_SUPPORT", targetBoardItemId: l.runtime.state.board.active!.id, support: contribution(text, [b.checkpointId]) });
    }
    expect(l.runtime.state.board.support).toHaveLength(2);
    expect(l.html()).toContain(a.text); expect(l.html()).not.toContain("Picture a hill.");
  });

  it.each(["TASK", "QUESTION"] as const)("keeps %s primary through a teacher hint, then replaces atomically with no stale hint", async (cueKind) => {
    const l = await lesson(); const a = await l.speech("Compare the two pathways."); await l.accept(keep, { action: "SET", cueKind, contribution: contribution(a.text, [a.checkpointId]) });
    const primary = l.runtime.state.cue.active!;
    const b = await l.speech("Hint: compare the heights."); await l.accept(keep, { action: "ATTACH_HINT", targetCueId: primary.id, contribution: contribution(b.text, [b.checkpointId]) });
    expect(l.runtime.state.cue.active).toMatchObject({ id: primary.id, kind: cueKind, activatedAt: primary.activatedAt, hint: { contribution: { content: b.text } } });
    expect(l.html()).toContain(a.text); expect(l.html()).toContain(b.text);
    const c = await l.speech("That task is finished. Now label the axes.");
    await l.accept(keep, { action: "REPLACE_CURRENT", targetCueId: primary.id, reason: "completed", evidence: ref(c.checkpointId), cueKind: "TASK", contribution: contribution("Label the axes.", [c.checkpointId]) });
    expect(l.runtime.state.cue.revision).toBe(3);
    expect(l.html()).toContain("Label the axes."); expect(l.html()).not.toContain(a.text); expect(l.html()).not.toContain(b.text);
    expect(l.runtime.replay.consumedCheckpointIds.size).toBe(3);
    expect((await LessonStreamRuntime.open("continuous", l.store)).state).toEqual(l.runtime.state);
  });

  it("QUESTION survives context and resolves only with current answer evidence, clearing its hint", async () => {
    const l = await lesson(); const a = await l.speech("Which pathway is faster?"); await l.accept(keep, { action: "SET", cueKind: "QUESTION", contribution: contribution(a.text, [a.checkpointId]) });
    const id = l.runtime.state.cue.active!.id;
    const h = await l.speech("Hint: consider the barrier."); await l.accept(keep, { action: "ATTACH_HINT", targetCueId: id, contribution: contribution(h.text, [h.checkpointId]) });
    const b = await l.speech("The temperature is constant."); await l.accept(board(b.text, [b.checkpointId])); expect(l.runtime.state.cue.active?.id).toBe(id);
    const c = await l.speech("The catalysed pathway is faster. That answers the question."); await l.accept(board("The catalysed pathway is faster.", [c.checkpointId]), { action: "RESOLVE_CURRENT", reason: "answered", evidence: ref(c.checkpointId) });
    expect(l.runtime.state.cue.active).toBeUndefined(); expect(l.html()).not.toContain("Which pathway"); expect(l.html()).toContain("catalysed pathway is faster");
  });

  it("forbids future batch references and arbitrary omitted lesson evidence", async () => {
    const l = await lesson(); const old = await l.speech("Old unrelated fact."); await l.accept();
    const a = await l.speech("Predict which pathway."); const b = await l.speech("The answer is the catalysed pathway.");
    const input = l.request();
    const raw = proposal(input, board(b.text, [b.checkpointId]));
    raw.steps = [{ ...raw.steps[0]!, consumesCheckpointIds: [a.checkpointId], evidenceRefs: [ref(a.checkpointId)] }, { consumesCheckpointIds: [b.checkpointId], boardDelta: keep, cueDelta: { action: "KEEP" }, evidenceRefs: [] }];
    expect((await l.runtime.acceptProposal({ proposal: raw, request: input, model: "test" })).ok).toBe(false);
    const omitted = { ...input, processedTimeline: [] };
    expect(validateAndNormalizeProposal({ proposal: proposal(omitted, board("Old unrelated fact.", [old.checkpointId])), request: omitted, state: l.runtime.state, allCheckpoints: l.runtime.checkpoints, model: "test" }).ok).toBe(false);
    expect(l.runtime.pending).toHaveLength(2); expect(l.html()).toBe("");
  });

  it("state conflict preserves the entire pending update and recovers from authoritative state", async () => {
    const l = await lesson(); const a = await l.speech("Note this."); await l.accept(keep, { action: "SET", cueKind: "NOTE", contribution: contribution(a.text, [a.checkpointId]) });
    const b = await l.speech("A new proposition."); const input = l.request();
    await l.runtime.expireCue(l.runtime.state.cue.active!.id, l.runtime.state.cue.revision);
    const result = await l.runtime.acceptProposal({ request: input, proposal: proposal(input, board(b.text, [b.checkpointId])), model: "test" });
    expect(result).toMatchObject({ ok: false, error: "interpretation-state-conflict", validationState: { cue: { revision: 2 } } });
    expect(l.runtime.pending).toHaveLength(1); expect(l.runtime.state.board.active).toBeUndefined();
    await l.accept(board(b.text, [b.checkpointId])); expect(l.html()).toContain(b.text); expect(l.runtime.pending).toEqual([]);
  });
});

describe("bounded lossless recovery", () => {
  afterEach(() => vi.useRealTimers());
  const evidence = (n: number): CompactEvidenceCheckpoint => ({ checkpointId: `c-${n}`, lessonSequence: n, speechRunId: "run", startMs: n, endMs: n, text: "Small text.", sourceFinalIds: [], warnings: [] });
  it("timeouts get two automatic retries with a pinned prefix, then explicit resume recovers all evidence", () => {
    vi.useFakeTimers(); const scheduler = new LosslessInterpretationScheduler(); const retry = new RetryBackoff();
    scheduler.enqueue([evidence(1)]); const batches: string[][] = [];
    const attempt = () => {
      if (retry.active) return;
      const next = scheduler.next("run"); if (!next) return;
      batches.push(next.work.checkpointIds);
      scheduler.settleFailed(next.work.requestId);
      scheduler.enqueue([evidence(batches.length + 1)]);
      retry.fail(attempt, "timeout");
    };
    attempt(); vi.runAllTimers();
    expect(batches).toEqual([["c-1"], ["c-1"], ["c-1"]]); expect(retry.isPaused).toBe(true); expect(scheduler.pendingCount).toBe(4);
    retry.accept(); const consumed: string[] = [];
    while (scheduler.pendingCount) { const next = scheduler.next("run")!; consumed.push(...next.work.checkpointIds); expect(next.checkpoints.length).toBeLessThanOrEqual(2); scheduler.settleAccepted(next.work.requestId, next.work.checkpointIds); }
    expect(consumed).toEqual(["c-1", "c-2", "c-3", "c-4"]);
  });
  it("full request budget can block even a tiny checkpoint without losing or truncating it", () => {
    const scheduler = new LosslessInterpretationScheduler(); scheduler.enqueue([evidence(1)]);
    expect(scheduler.next("run", 3500, 0, () => false)).toBeUndefined(); expect(scheduler.isBudgetBlocked).toBe(true); expect(scheduler.pendingCount).toBe(1);
    expect(scheduler.next("run", 3500, 0, () => true)?.work.checkpointIds).toEqual(["c-1"]);
  });
  it("classifies failures, pauses validation immediately and never retries cancellation", () => {
    vi.useFakeTimers(); const retry = new RetryBackoff(); const pump = vi.fn();
    retry.fail(pump, "cancelled"); expect(retry.consecutiveFailures).toBe(0);
    retry.fail(pump, "validation"); vi.runAllTimers(); expect(pump).not.toHaveBeenCalled(); expect(retry.isPaused).toBe(true);
    expect(["proposal-invalid", "teaching-provider-http-500", "teaching-interpretation-timeout", "interpretation-state-conflict"].map((s) => classifyInterpretationFailure(s))).toEqual(["validation", "provider", "timeout", "conflict"]);
    expect(interpretationDeadlines()).toEqual({ providerMs: 6000, clientMs: 8000 });
    expect(interpretationDeadlines("30000", true)).toEqual({ providerMs: 30000, clientMs: 32000 });
    expect(interpretationDeadlines("30000", false).providerMs).toBe(6000);
  });
});
