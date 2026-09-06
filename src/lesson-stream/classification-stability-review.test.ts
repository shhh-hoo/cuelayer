import { describe, expect, it } from "vitest";
import { createInitialTeachingState, reduceAcceptedStep } from "./teaching-state";
import type { AcceptedInterpretationStep, BoardDelta } from "./contracts";

/** Authored synthetic mechanism review, not corpus gold, model evaluation or desired-loss regression. */
const cases = [
  { label: "Heterogeneous catalyst", definition: "Catalyst and reactants are in different phases.", examples: ["A solid catalyst acts on gases.", "Gas reactants contact a solid catalyst."] },
  { label: "Exothermic reaction", definition: "Energy transfers from the system to the surroundings.", examples: ["This combustion releases heat.", "The burning sample releases heat."] },
  { label: "Physical change", definition: "The substance retains its chemical identity.", examples: ["Ice melts.", "A second ice sample melts."] },
];
const contribution = <T,>(content: T) => ({ mode: "REPRESENT" as const, content, provenance: { basis: "SPEECH" as const, speechRefs: [{ checkpointId: "synthetic-source", quote: "Authored review material" }] } });
describe("classification stability mechanism review (no policy/capacity repair)", () => {
  it.each(cases)("isolates placement versus ordinary Support eviction: $label", ({ label, definition, examples }) => {
    for (const definitionInActive of [false, true]) {
      let state = createInitialTeachingState(); let n = 0;
      const apply = (boardDelta: BoardDelta) => {
        const step: AcceptedInterpretationStep = { interpretationId: `synthetic-${++n}`, requestId: "synthetic", stepIndex: 0, consumesCheckpointIds: [], baseBoardRevision: state.board.revision, baseCueRevision: 0, boardDelta, cueDelta: { action: "KEEP" }, evidenceRefs: [], warnings: [], model: "no-provider", policyVersion: "synthetic-review", acceptedAt: "2026-09-06T00:00:00Z" };
        state = reduceAcceptedStep(state, step, new Map());
      };
      apply({ action: "SET_ACTIVE", continuity: "topic_shift", retainPrevious: false, contribution: contribution({ kind: "TEXT", text: definitionInActive ? `${label}: ${definition}` : label }), support: definitionInActive ? [] : [contribution(definition)] });
      const activeId = state.board.active!.id;
      for (const example of examples) apply({ action: "ADD_SUPPORT", targetBoardItemId: activeId, support: contribution(example) });
      expect(state.board.active!.id).toBe(activeId);
      expect(state.board.support.map(item => item.contribution.content)).toEqual(examples);
      expect(JSON.stringify(state.board)).toContain(definitionInActive ? definition : label);
      if (!definitionInActive) expect(JSON.stringify(state.board)).not.toContain(definition);
      // Same reducer, same capacity, same examples; only authored BoardDelta placement varies.
    }
  });
});
