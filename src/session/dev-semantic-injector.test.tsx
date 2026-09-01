import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { compileCaptionEpisode } from "../planner/caption-compiler";
import { validateRuntimeDecision } from "../planner/validation";
import { createSyntheticSemanticFixture, SYNTHETIC_INTENT_KINDS } from "./dev-semantic-fixtures";
import { SemanticCaptionLayer } from "./SemanticCaptionLayer";
import { createInitialSessionState, sessionReducer } from "./session-state";

describe("development semantic cue injector", () => {
  it("keeps every deterministic fixture inside the production decision contracts", () => {
    for (const [index, kind] of SYNTHETIC_INTENT_KINDS.entries()) {
      const fixture = createSyntheticSemanticFixture(kind, index + 1);
      const validation = validateRuntimeDecision(fixture.decision, fixture.input);
      expect(validation.ok, kind).toBe(true);
      if (!validation.ok) continue;
      const episode = compileCaptionEpisode(fixture.input, validation.decision, fixture.episodeId, 100);
      expect(Boolean(episode), kind).toBe(kind !== "QUIET");
      if (kind === "FOCUS" || kind === "RELATE" || kind === "TRANSFORM") expect(episode?.cue?.kind).toBe(kind);
    }
  });

  it("runs compiler → runtime → semantic renderer without ASR, commits, or planner invocation", () => {
    const fixture = createSyntheticSemanticFixture("FOCUS", 1);
    let state = createInitialSessionState(true);
    state = sessionReducer(state, { type: "debug-inject-decision", ...fixture, now: 100 });

    expect(state.speech.canonical.finals).toEqual([]);
    expect(state.speech.canonical.spans).toEqual([]);
    expect(state.speech.status).toBe("off");
    expect(state.planner).toMatchObject({ status: "idle", requestId: 0 });
    expect(state.planner.runtime.current?.cue).toMatchObject({ kind: "FOCUS", treatment: "marker" });

    const html = renderToStaticMarkup(<SemanticCaptionLayer
      runtime={state.planner.runtime}
      onExpire={() => undefined}
      onLearnerCueExpire={() => undefined}
    />);
    expect(html).toContain("Activation energy");
    expect(html).toContain("semantic-caption");

    state = sessionReducer(state, { type: "renderer-activated", episode: state.planner.runtime.current!, now: 125 });
    expect(state.trace.events.map((event) => `${event.stage}:${event.decision}`)).toEqual(["compile:emit", "render:activated"]);
    expect(state.trace.events.every((event) => event.traceId === fixture.traceId && event.source === "synthetic")).toBe(true);
    expect(state.trace.events.every((event) => !event.segmentId?.startsWith("committed-"))).toBe(true);
    expect(state.trace.events[0]).toMatchObject({ cueId: fixture.episodeId, displayIntent: { kind: "FOCUS" } });
    expect(state.trace.events[1]).toMatchObject({ cueId: fixture.episodeId, status: "rendered", latencyMs: 25 });
  });

  it("reaches distinct RELATE and TRANSFORM renderer treatments", () => {
    for (const kind of ["RELATE", "TRANSFORM"] as const) {
      const fixture = createSyntheticSemanticFixture(kind, kind === "RELATE" ? 2 : 3);
      let state = sessionReducer(createInitialSessionState(true), { type: "debug-inject-decision", ...fixture, now: 200 });
      expect(state.planner.runtime.current?.cue?.kind).toBe(kind);
      state = sessionReducer(state, { type: "renderer-activated", episode: state.planner.runtime.current!, now: 210 });
      expect(state.trace.events.at(-1)).toMatchObject({ traceId: fixture.traceId, source: "synthetic", stage: "render", decision: "activated", cueId: fixture.episodeId });
    }
  });

  it("ignores synthetic injection when development tracing is disabled", () => {
    const initial = createInitialSessionState(false);
    const fixture = createSyntheticSemanticFixture("FOCUS", 1);
    expect(sessionReducer(initial, { type: "debug-inject-decision", ...fixture, now: 100 })).toBe(initial);
  });
});
