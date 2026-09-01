import type { DisplayIntent, GroundedSpeechTurn, PlannerInput, RuntimeDecision } from "../planner/contracts";

export const SYNTHETIC_INTENT_KINDS = ["QUIET", "TEXT", "FOCUS", "RELATE", "TRANSFORM"] as const;
export type SyntheticIntentKind = typeof SYNTHETIC_INTENT_KINDS[number];

export type SyntheticSemanticFixture = {
  traceId: string;
  episodeId: string;
  input: PlannerInput;
  decision: RuntimeDecision;
};

function turn(id: string, text: string): GroundedSpeechTurn {
  return {
    id,
    text,
    words: text.split(/\s+/).map((word, index) => ({ text: word, startMs: index * 120, endMs: index * 120 + 100 })),
  };
}

function fixtureDefinition(kind: SyntheticIntentKind, segmentId: string): { turn: GroundedSpeechTurn; display: DisplayIntent } {
  if (kind === "QUIET") {
    return { turn: turn(segmentId, "Okay, let's move on."), display: { kind: "QUIET", reason: "transition" } };
  }
  if (kind === "TEXT") {
    return { turn: turn(segmentId, "Activation energy controls the reaction rate."), display: { kind: "TEXT" } };
  }
  if (kind === "FOCUS") {
    return { turn: turn(segmentId, "Activation energy controls the reaction rate."), display: { kind: "FOCUS", target: { segmentId, text: "Activation energy" } } };
  }
  if (kind === "RELATE") {
    return {
      turn: turn(segmentId, "Higher temperature causes particles to move faster."),
      display: { kind: "RELATE", relation: "cause", targets: [{ segmentId, text: "Higher temperature" }, { segmentId, text: "particles to move faster" }] },
    };
  }
  return {
    turn: turn(segmentId, "Solid iodine changes to liquid iodine."),
    display: { kind: "TRANSFORM", from: { segmentId, text: "Solid iodine" }, to: { segmentId, text: "liquid iodine" } },
  };
}

/** Deterministic teaching input that replaces only ASR/planner for local downstream verification. */
export function createSyntheticSemanticFixture(kind: SyntheticIntentKind, sequence: number): SyntheticSemanticFixture {
  const traceId = `synthetic:${kind.toLowerCase()}:${sequence}`;
  const segmentId = `${traceId}:source`;
  const definition = fixtureDefinition(kind, segmentId);
  const input = { recentSpeech: [definition.turn] };
  return {
    traceId,
    episodeId: `synthetic-caption-${kind.toLowerCase()}-${sequence}`,
    input,
    decision: {
      display: definition.display,
      learner: { kind: "NONE" },
    },
  };
}
