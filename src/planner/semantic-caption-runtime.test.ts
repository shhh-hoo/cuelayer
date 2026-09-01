import { describe, expect, it } from "vitest";
import { compileCaptionEpisode } from "./caption-compiler";
import { fallbackFromGroundedSpeech, validateRuntimeDecision } from "./validation";
import type { GroundedSpeechTurn, PlannerInput, RuntimeDecision } from "./contracts";
import { createInitialSessionState, sessionReducer } from "../session/session-state";

function turn(id: string, text: string): GroundedSpeechTurn {
  return { id, text, words: text.replace(/[.]/g, "").split(" ").map((word, index) => ({ text: word, startMs: index * 100, endMs: index * 100 + 80 })) };
}
const ref = (segmentId: string, text: string) => ({ segmentId, text });
const input = (recentSpeech: GroundedSpeechTurn[]): PlannerInput => ({ recentSpeech });
const decide = (display: RuntimeDecision["display"], evidence?: RuntimeDecision["evidence"]): RuntimeDecision => ({ display, learner: { kind: "NONE" }, ...(evidence ? { evidence } : {}) });

function readySession(traceEnabled = false) {
  let state = sessionReducer(createInitialSessionState(traceEnabled), { type: "begin-speech", runId: 1 });
  return sessionReducer(state, { type: "speech-ready", runId: 1 });
}

describe("compact live semantic decision", () => {
  it("compiles grounded display decisions into the existing renderer grammar", () => {
    const speech = input([
      turn("committed-0", "Higher temperature causes particles to move faster."),
      turn("committed-1", "First calculate the number of moles, then use the mole ratio."),
      turn("committed-2", "Solid iodine changes to liquid iodine."),
    ]);
    const focus = validateRuntimeDecision(decide({ kind: "FOCUS", target: ref("committed-0", "temperature") }), speech);
    const cause = validateRuntimeDecision(decide({ kind: "RELATE", relation: "cause", targets: [ref("committed-0", "Higher temperature"), ref("committed-0", "particles to move faster")] }), speech);
    const sequence = validateRuntimeDecision(decide({ kind: "RELATE", relation: "sequence", targets: [ref("committed-1", "calculate the number of moles"), ref("committed-1", "use the mole ratio")] }), speech);
    const transform = validateRuntimeDecision(decide({ kind: "TRANSFORM", from: ref("committed-2", "Solid iodine"), to: ref("committed-2", "liquid iodine") }), speech);
    expect(focus.ok && compileCaptionEpisode(speech, focus.decision, "focus", 0)?.cue).toMatchObject({ kind: "FOCUS", treatment: "marker" });
    expect(cause.ok && compileCaptionEpisode(speech, cause.decision, "cause", 0)?.cue).toMatchObject({ kind: "RELATE", relation: "cause", treatment: "chain" });
    expect(sequence.ok && compileCaptionEpisode(speech, sequence.decision, "sequence", 0)?.cue).toMatchObject({ kind: "RELATE", relation: "sequence", treatment: "ordered-steps" });
    expect(transform.ok && compileCaptionEpisode(speech, transform.decision, "transform", 0)?.cue).toMatchObject({ kind: "TRANSFORM", treatment: "state-change" });
  });

  it("keeps authorized symbolic compression optional and speech-grounded", () => {
    const speech = input([turn("committed-0", "The activation energy is important.")]);
    const result = validateRuntimeDecision(decide({ kind: "FOCUS", target: ref("committed-0", "activation energy") }, { rewrites: [{ source: ref("committed-0", "activation energy"), displayText: "E_A" }] }), speech);
    expect(result.ok && compileCaptionEpisode(speech, result.decision, "rewrite", 0)?.cue).toMatchObject({ target: { displayText: "E_A" } });
  });

  it("never silently corrects teacher speech or fabricate missing chemistry", () => {
    const preservedSpeech = input([turn("committed-0", "This is endothermic — sorry, I mean exothermic.")]);
    const preserved = validateRuntimeDecision(decide({ kind: "TEXT" }), preservedSpeech);
    const blockedSpeech = input([turn("committed-1", "Make the ester from this.")]);
    const blocked = validateRuntimeDecision(decide({ kind: "RELATE", relation: "cause", targets: [ref("committed-1", "ester"), ref("committed-1", "this")] }, { warnings: [{ code: "MISSING_REFERENCE", target: ref("committed-1", "this") }] }), blockedSpeech);
    expect(preserved.ok && compileCaptionEpisode(preservedSpeech, preserved.decision, "preserved", 0)?.clip.captionText).toContain("endothermic — sorry, I mean exothermic");
    expect(blocked).toMatchObject({ ok: true, degradation: "invalid-relation", decision: { display: { kind: "TEXT" } } });
  });

  it("preserves the full canonical speech surface for TEXT and every semantic display intent", () => {
    const textSpeech = input([turn("speech-span-0", "The reaction mixture remains colourless")]);
    const textDecision = decide({ kind: "TEXT" });
    const focusDecision = decide({ kind: "FOCUS", target: ref("speech-span-0", "colourless") });
    expect(compileCaptionEpisode(textSpeech, textDecision, "text", 0)?.clip.captionText).toBe("The reaction mixture remains colourless");
    expect(compileCaptionEpisode(textSpeech, focusDecision, "focus-context", 0)?.clip.captionText).toBe("The reaction mixture remains colourless");

    const relateSpeech = input([turn("speech-span-1", "Higher temperature causes particles to move faster in the reaction mixture")]);
    const relateDecision = decide({ kind: "RELATE", relation: "cause", targets: [ref("speech-span-1", "Higher temperature"), ref("speech-span-1", "particles to move faster")] });
    expect(compileCaptionEpisode(relateSpeech, relateDecision, "relate-context", 0)?.clip.captionText).toBe("Higher temperature causes particles to move faster in the reaction mixture");

    const transformSpeech = input([turn("speech-span-2", "The alkene is converted into an alcohol under these conditions")]);
    const transformDecision = decide({ kind: "TRANSFORM", from: ref("speech-span-2", "alkene"), to: ref("speech-span-2", "alcohol") });
    expect(compileCaptionEpisode(transformSpeech, transformDecision, "transform-context", 0)?.clip.captionText).toBe("The alkene is converted into an alcohol under these conditions");
  });

  it("deterministically degrades an invalid relation to the current canonical span", () => {
    const speech = input([turn("committed-0", "Higher temperature causes particles to move faster.")]);
    const invalid = validateRuntimeDecision(decide({ kind: "RELATE", relation: "cause", targets: [ref("committed-0", "temperature"), ref("committed-0", "not spoken")] }), speech);
    expect(invalid).toMatchObject({ ok: true, degradation: "invalid-relation", decision: { display: { kind: "TEXT" } } });
  });

  it.each([
    { relation: "cause" as const, plain: "Temperature is high and particles move fast.", explicit: "Temperature causes particles to move fast.", left: "Temperature", right: "particles" },
    { relation: "sequence" as const, plain: "Calculate the moles and use the ratio.", explicit: "First calculate the moles, then use the ratio.", left: "calculate the moles", right: "use the ratio" },
    { relation: "contrast" as const, plain: "Diamond is hard and graphite is soft.", explicit: "Diamond is hard, whereas graphite is soft.", left: "Diamond is hard", right: "graphite is soft" },
  ])("requires explicit $relation evidence even when both phrases are grounded", ({ relation, plain, explicit, left, right }) => {
    const ungroundedInput = input([turn("committed-0", plain)]);
    const ungrounded = validateRuntimeDecision(decide({ kind: "RELATE", relation, targets: [ref("committed-0", left), ref("committed-0", right)] }), ungroundedInput);
    expect(ungrounded).toMatchObject({ ok: true, degradation: "invalid-relation", decision: { display: { kind: "TEXT" } } });

    const groundedInput = input([turn("committed-0", explicit)]);
    const grounded = validateRuntimeDecision(decide({ kind: "RELATE", relation, targets: [ref("committed-0", left), ref("committed-0", right)] }), groundedInput);
    expect(grounded).toMatchObject({ ok: true, decision: { display: { kind: "RELATE", relation } } });
  });

  it("grounds relation evidence across multiple referenced committed segments", () => {
    const speech = input([
      turn("committed-0", "First calculate the number of moles."),
      turn("committed-1", "Then use the mole ratio."),
    ]);
    const result = validateRuntimeDecision(decide({ kind: "RELATE", relation: "sequence", targets: [ref("committed-0", "calculate the number of moles"), ref("committed-1", "use the mole ratio")] }), speech);
    expect(result).toMatchObject({ ok: true, decision: { display: { kind: "RELATE", relation: "sequence" } } });
  });

  it("accepts an observed non-adjacent comparative and passive transformation", () => {
    const contrastInput = input([turn("committed-0", "Magnesium has a higher melting point than sodium.")]);
    const contrast = validateRuntimeDecision(decide({ kind: "RELATE", relation: "contrast", targets: [ref("committed-0", "Magnesium"), ref("committed-0", "sodium")] }), contrastInput);
    expect(contrast).toMatchObject({ ok: true, decision: { display: { kind: "RELATE", relation: "contrast" } } });

    const transformInput = input([turn("committed-1", "The alkene is converted into an alcohol.")]);
    const transform = validateRuntimeDecision(decide({ kind: "TRANSFORM", from: ref("committed-1", "alkene"), to: ref("committed-1", "alcohol") }), transformInput);
    expect(transform).toMatchObject({ ok: true, decision: { display: { kind: "TRANSFORM" } } });
  });

  it("degrades invalid FOCUS and malformed TEXT to the current canonical span", () => {
    const speech = input([turn("committed-0", "The activation energy is the minimum energy.")]);
    expect(validateRuntimeDecision(decide({ kind: "FOCUS", target: ref("committed-0", "missing") }), speech)).toMatchObject({ ok: true, degradation: "invalid-focus", decision: { display: { kind: "TEXT" } } });
    expect(validateRuntimeDecision({ display: { kind: "TEXT", text: ref("committed-0", "missing") }, learner: { kind: "NONE" } }, speech)).toMatchObject({ ok: true, degradation: "invalid-text", decision: { display: { kind: "TEXT" } } });
  });

  it("rejects duplicate RELATE targets and preserves an ambiguous conjunction as TEXT", () => {
    const speech = input([turn("committed-0", "Diamond is hard and graphite is soft.")]);
    const duplicate = validateRuntimeDecision(decide({ kind: "RELATE", relation: "contrast", targets: [ref("committed-0", "Diamond is hard"), ref("committed-0", "Diamond is hard")] }), speech);
    const ambiguous = validateRuntimeDecision(decide({ kind: "RELATE", relation: "contrast", targets: [ref("committed-0", "Diamond is hard"), ref("committed-0", "graphite is soft")] }), speech);
    expect(duplicate).toMatchObject({ ok: true, degradation: "invalid-relation", decision: { display: { kind: "TEXT" } } });
    expect(ambiguous).toMatchObject({ ok: true, degradation: "invalid-relation", decision: { display: { kind: "TEXT" } } });
    expect(ambiguous.ok && compileCaptionEpisode(speech, ambiguous.decision, "ambiguous", 0)?.clip.captionText).toBe("Diamond is hard and graphite is soft.");
  });

  it("uses only committed state for provider failure fallback", () => {
    expect(fallbackFromGroundedSpeech(input([turn("committed-0", "Useful stable proposition.")]))).toEqual(decide({ kind: "TEXT" }));
    expect(fallbackFromGroundedSpeech(input([turn("committed-0", "Okay, let's move on.")]))).toEqual(decide({ kind: "QUIET", reason: "transition" }));
  });

  it("clears a failed request and emits a safe fallback so later speech can continue", () => {
    let state = readySession(true);
    const speech = turn("speech-span-0", "A useful stable proposition.");
    state = sessionReducer(state, { type: "speech-event", runId: 1, event: { kind: "committed", text: speech.text, words: speech.words }, now: 0 });
    const plannerInput = input(state.speech.canonical.spans);
    const checkpoint = { spanId: "speech-span-0", spanRevision: 1, segmentIds: ["speech-span-0"] };
    state = sessionReducer(state, { type: "planner-requested", requestId: 1, runId: 1, ...checkpoint, input: plannerInput, now: 0 });
    state = sessionReducer(state, { type: "planner-failed", requestId: 1, runId: 1, ...checkpoint, input: plannerInput, message: "planner-provider-unavailable", now: 10 });
    expect(state.planner.status).toBe("ready");
    expect(state.planner.runtime.current?.clip.captionText).toBe("A useful stable proposition.");
    state = sessionReducer(state, { type: "planner-requested", requestId: 2, runId: 1, ...checkpoint, input: plannerInput, now: 20 });
    expect(state.planner.inFlightRequestId).toBe(2);
  });

  it("traces cancellation without rendering stale output, then accepts the newest revision", () => {
    let state = readySession(true);
    const oldSpeech = turn("speech-span-0", "The old provider call is still running.");
    state = sessionReducer(state, { type: "speech-event", runId: 1, event: { kind: "committed", text: oldSpeech.text, words: oldSpeech.words }, now: 0 });
    const oldInput = input(state.speech.canonical.spans);
    const oldCheckpoint = { spanId: "speech-span-0", spanRevision: 1, segmentIds: ["speech-span-0"] };
    state = sessionReducer(state, { type: "planner-requested", requestId: 1, runId: 1, ...oldCheckpoint, input: oldInput, now: 0 });
    state = sessionReducer(state, { type: "planner-aborted", requestId: 1, runId: 1, ...oldCheckpoint, input: oldInput, reason: "superseded_by_newer_checkpoint", startedAt: 0, now: 10_000 });
    const afterAbort = state;
    state = sessionReducer(state, { type: "planner-decision", requestId: 1, runId: 1, ...oldCheckpoint, input: oldInput, decision: decide({ kind: "FOCUS", target: ref("speech-span-0", "old") }), startedAt: 0, now: 10_001 });
    expect(state).toBe(afterAbort);
    expect(state.planner.runtime.current).toBeUndefined();
    expect(state.trace.events.at(-1)).toMatchObject({ stage: "planner", decision: "aborted", reason: "superseded_by_newer_checkpoint", latencyMs: 10_000 });

    const newestSpeech = turn("speech-span-1", "The newest revision is ready.");
    state = sessionReducer(state, { type: "speech-event", runId: 1, event: { kind: "committed", text: newestSpeech.text, words: newestSpeech.words }, now: 10_001 });
    const latestInput = input(state.speech.canonical.spans);
    const latestCheckpoint = { spanId: "speech-span-1", spanRevision: 1, segmentIds: ["speech-span-1"] };
    state = sessionReducer(state, { type: "planner-requested", requestId: 2, runId: 1, ...latestCheckpoint, input: latestInput, now: 10_002 });
    state = sessionReducer(state, { type: "planner-decision", requestId: 2, runId: 1, ...latestCheckpoint, input: latestInput, decision: decide({ kind: "TEXT" }), startedAt: 10_002, now: 10_003 });
    expect(state.planner.runtime.current?.clip.captionText).toBe("The newest revision is ready.");
  });

  it("treats the live planner deadline as a traced non-error without replacing the caption", () => {
    let state = readySession(true);
    const speech = turn("speech-span-0", "A stable caption remains visible.");
    state = sessionReducer(state, { type: "speech-event", runId: 1, event: { kind: "committed", text: speech.text, words: speech.words }, now: 0 });
    const plannerInput = input(state.speech.canonical.spans);
    const checkpoint = { spanId: "speech-span-0", spanRevision: 1, segmentIds: ["speech-span-0"] };
    state = sessionReducer(state, { type: "planner-requested", requestId: 1, runId: 1, ...checkpoint, input: plannerInput, now: 0 });
    state = sessionReducer(state, { type: "planner-aborted", requestId: 1, runId: 1, ...checkpoint, input: plannerInput, reason: "live_budget_timeout", startedAt: 0, now: 2_500 });
    expect(state.planner).toMatchObject({ status: "ready", inFlightRequestId: undefined });
    expect(state.planner.runtime.current).toBeUndefined();
    expect(state.trace.events.at(-1)).toMatchObject({ stage: "planner", decision: "aborted", reason: "live_budget_timeout", latencyMs: 2_500 });
  });
});
