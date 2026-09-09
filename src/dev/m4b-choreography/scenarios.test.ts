import { beforeAll, describe, expect, it } from "vitest";
import { CORE_EVENT_SCHEMA_VERSION, type CoreStep, type SemanticReference } from "../../lesson-stream/core/contracts.ts";
import { coreAcceptedEvent, coreEntityId } from "../../lesson-stream/core/events.ts";
import { reduceCoreStep } from "../../lesson-stream/core/teaching-state.ts";
import { M4A_GROUNDED_LEARNER_PROJECTION_FIXTURES } from "../../learner-projection/grounded-fixtures.ts";
import { inlineRepresentations, referenceKeys, semanticKey, transientKey } from "../../canvas-spatial/spatial.ts";
import { SCENARIOS, fixture } from "../m4b-canvas/scenarios.ts";
import type { ChoreographyScenario, ChoreographyStep } from "./scenarios.ts";

// Capture the original review inputs before evaluating the new scenario module.
const originalScenarios = JSON.stringify(SCENARIOS);
const originalFixtures = JSON.stringify(M4A_GROUNDED_LEARNER_PROJECTION_FIXTURES);
let scenarios: ChoreographyScenario[];
beforeAll(async () => { scenarios = (await import("./scenarios.ts")).CHOREOGRAPHY_SCENARIOS; });
const scenario = (id: string) => scenarios.find(item => item.id === id)!;
const step = (id: string, label: string) => scenario(id).steps.find(item => item.label === label)!;
const refs = (item: ChoreographyStep, values: SemanticReference[]) => [...new Set(values.flatMap(ref => referenceKeys(item.state, ref)))];
const primaryKeys = (item: ChoreographyStep) => {
  const attention = item.projection.attention;
  const keys = refs(item, [...(attention.anchor ? [attention.anchor] : []), ...attention.emphasis]);
  const inline = new Set(inlineRepresentations(item.projection).map(rep => rep.id));
  for (const rep of attention.representations.filter(rep => rep.role === "dominant")) {
    keys.push(...(inline.has(rep.id) && rep.target ? referenceKeys(item.state, rep.target)
      : [transientKey(item.state.sessionId, "REPRESENTATION", rep.id)]));
  }
  return [...new Set(keys)];
};

describe("isolated choreography teaching inputs", () => {
  it("does not mutate existing M4A fixtures or either M4B review input", () => {
    expect(JSON.stringify(SCENARIOS)).toBe(originalScenarios);
    expect(JSON.stringify(M4A_GROUNDED_LEARNER_PROJECTION_FIXTURES)).toBe(originalFixtures);
    expect(scenarios.every(item => item.source.length > 40)).toBe(true);
  });

  it("reuses the complete Catalyst propositions and the single accepted relationship", () => {
    const home = step("teaching-story", "HOME · Catalyst Option 2");
    expect(home.home).toBe(true);
    expect(home.state.knowledge.cores.catalysts).toEqual(fixture("rsc-catalyst-open-practical").input.state.knowledge.cores.catalysts);
    const relations = Object.values(home.state.knowledge.cores.catalysts!.relations);
    expect(relations).toHaveLength(1);
    expect(relations[0]!.value).toMatchObject({ fromObjectId: "alternative-path", toObjectId: "lower-ea" });
    expect(home.projection).toEqual(SCENARIOS.find(item => item.id === "growth")!.steps[2]!.projection);
  });

  it("selects exactly the two requested cross-Core objects without inventing an edge", () => {
    const item = step("teaching-story", "WIDEN · Two distant propositions");
    const { attention } = item.projection;
    expect(attention.anchor).toMatchObject({ kind: "OBJECT", coreId: "arrhenius" });
    expect(attention.context).toEqual([{ kind: "OBJECT", coreId: "catalysts", id: "lower-ea" }]);
    expect(attention.emphasis).toEqual([]);
    expect(attention.support).toEqual([]);
    expect(attention.representations).toEqual([]);
    expect(item.projection.workSurface).toBeUndefined();
    expect(refs(item, [attention.anchor!, ...attention.context])).toHaveLength(2);
    expect(item.projection.parkedCoreIds).toContain("catalysts");
    for (const core of Object.values(item.state.knowledge.cores)) for (const relation of Object.values(core.relations)) {
      expect(core.objects[relation.value.fromObjectId]).toBeDefined();
      expect(core.objects[relation.value.toObjectId]).toBeDefined();
    }
    const beforeAddition = scenario("teaching-story").steps[5]!;
    expect(item.state.knowledge.cores.arrhenius!.relations).toEqual(beforeAddition.state.knowledge.cores.arrhenius!.relations);
  });

  it("accepts a stable generated object identity and later revises the same identity", () => {
    const added = step("teaching-story", "FOCUS · Lower barrier and rate");
    const revised = step("teaching-story", "WIDEN · Teaching explanation progresses");
    const before = scenario("teaching-story").steps[5]!;
    const id = coreEntityId(added.state.sessionId, { requestId: "m4b:choreography:lower-barrier-rate", stepIndex: 0 }, "OBJECT", 0);
    expect(added.projection.attention.anchor).toEqual({ kind: "OBJECT", coreId: "arrhenius", id });
    expect(revised.projection.attention.anchor).toEqual(added.projection.attention.anchor);
    expect(added.state.knowledge.revision).toBe(before.state.knowledge.revision + 1);
    expect(revised.state.knowledge.revision).toBe(added.state.knowledge.revision + 1);
    expect(revised.state.processedThroughSequence).toBe(added.state.processedThroughSequence + 1);
    expect(revised.state.cue).toEqual(before.state.cue);
    expect(Object.keys(revised.state.knowledge.cores.arrhenius!.objects)).toEqual(Object.keys(added.state.knowledge.cores.arrhenius!.objects));
    expect(added.state.knowledge.cores.arrhenius!.objects[id]!.value.text).toContain("For fixed A and temperature");
    expect(revised.state.knowledge.cores.arrhenius!.objects[id]!.value.text).toContain("exponential factor");
  });

  it("preserves every established story identity through growth, widening and refocus", () => {
    const accepted = new Set<string>();
    for (const item of scenario("teaching-story").steps) {
      const now = new Set(Object.values(item.state.knowledge.cores).flatMap(core => [
        semanticKey(item.state.sessionId, { kind: "CORE", id: core.id }),
        ...Object.keys(core.objects).map(id => semanticKey(item.state.sessionId, { kind: "OBJECT", coreId: core.id, id })),
      ]));
      for (const key of accepted) expect(now.has(key)).toBe(true);
      for (const key of now) accepted.add(key);
      expect(JSON.stringify({ state: item.state, projection: item.projection })).not.toMatch(/"(?:homePosition|presentationPosition|coordinates|reactFlowId|zoom)"\s*:/);
    }
  });

  it("keeps semantic refocus compatible with the unchanged versioned acceptance boundary", () => {
    const sequence = scenario("teaching-story").steps;
    const before = sequence.at(-2)!.state;
    const after = sequence.at(-1)!;
    const checkpointId = "m4b:choreography:accepted-catalyst-refocus";
    const quote = "Let's return to the catalyst explanation.";
    const accepted: CoreStep = {
      requestId: checkpointId, stepIndex: 0, baseKnowledgeRevision: before.knowledge.revision,
      baseCueRevision: before.cue.revision, consumesCheckpointIds: [checkpointId],
      knowledgeOps: [{ action: "SET_CURRENT_CORE", coreId: "catalysts" }], cueDelta: { action: "KEEP" },
      evidenceRefs: [{ checkpointId, quote }], stateRefs: [], warnings: [], acceptedAt: "2026-09-09T08:00:00.000Z",
    };
    const event = coreAcceptedEvent(before.sessionId, 1, accepted);
    expect(event.schemaVersion).toBe(CORE_EVENT_SCHEMA_VERSION);
    expect(reduceCoreStep(before, accepted, [{ checkpointId, lessonSequence: before.processedThroughSequence + 1,
      speechRunId: "m4b:choreography:synthetic", startMs: 0, endMs: 1, text: quote, sourceFinalIds: [], warnings: [] }])).toEqual(after.state);
    expect(after.state.knowledge.currentCoreId).toBe("catalysts");
    expect(after.state.knowledge.cores).toEqual(before.knowledge.cores);
    expect(after.state.cue).toEqual(before.cue);
    expect(after.recentChanges).toEqual([{ ref: { kind: "CORE", id: "catalysts" }, kind: "REFOCUSED" }]);
  });

  it("retains the complete real trigonometry comparison and its inline identity", () => {
    const item = step("trig-compare", "COMPARE · Base and transformed sine");
    expect(item.projection).toEqual(fixture("math-trig-graph-comparison").expected);
    expect(inlineRepresentations(item.projection).map(rep => rep.id)).toEqual(["trig-comparison"]);
    expect(primaryKeys(item)).toHaveLength(2);
    expect(item.projection.attention.context).toEqual([{ kind: "OBJECT", coreId: "trig-graphs", id: "equivalent-form" }]);
    expect(item.projection.workSurface?.blocks.map(block => block.id)).toEqual(["learner-trig-sketch"]);
  });

  it("retains all five History co-primary identities and its distinct transient Work", () => {
    const item = step("history-compare", "COMPARE · Interpretations and both sources");
    expect(item.projection).toEqual(fixture("history-contemporary-sources-competing-interpretations").expected);
    expect(inlineRepresentations(item.projection)).toEqual([]);
    expect(primaryKeys(item)).toHaveLength(5);
    expect(item.projection.attention.representations.map(rep => rep.id)).toEqual(["source-a", "source-b"]);
    expect(item.projection.workSurface?.blocks.map(block => block.id)).toEqual(["source-comparison-notes"]);
    expect(scenario("history-compare").source).toContain("not supplied");
  });

  it("revises long text in place and separates held view from explicit reframe", () => {
    const before = step("long-text", "WIDEN · Before the long revision");
    const held = step("long-text", "PRESERVE_VIEW · Long accepted text, positions held");
    const reframed = step("long-text", "WIDEN · Recompose the measured long text");
    expect(held.state.knowledge.cores.catalysts!.objects["lower-ea"]!.id).toBe("lower-ea");
    expect(held.state.knowledge.cores.catalysts!.objects["lower-ea"]!.value.text.length).toBeGreaterThan(600);
    expect(held.state.knowledge.revision).toBe(before.state.knowledge.revision + 1);
    expect(held.projection.projector).toBe("PRESERVE_VIEW");
    expect(reframed.projection.projector).toBe("REFRAME_ATTENTION");
    expect(reframed.state).toEqual(held.state);
    expect(reframed.projection.attention).toEqual(before.projection.attention);
    expect(Object.keys(reframed.state.knowledge.cores.catalysts!.objects)).toEqual(Object.keys(before.state.knowledge.cores.catalysts!.objects));
  });

  it("keeps Work ephemeral and retains Support after its visual omission", () => {
    const work = scenario("work").steps;
    expect(work[0]!.projection.workSurface).toBeUndefined();
    expect(work[1]!.projection.workSurface).toMatchObject({ lifecycle: "EPHEMERAL", blocks: [{ id: "dry-run-table", status: "IN_PROGRESS" }] });
    expect(work[2]!.projection.workSurface?.blocks[0]!.status).toBe("SETTLED");
    expect(work[3]!.projection.workSurface).toBeUndefined();
    expect(work.every(item => JSON.stringify(item.state) === JSON.stringify(work[0]!.state))).toBe(true);
    const support = scenario("support").steps;
    expect(support[1]!.projection.attention.support).toEqual([]);
    expect(support[2]!.state.knowledge.cores.kinetics!.supports).toEqual(support[0]!.state.knowledge.cores.kinetics!.supports);
    expect(support[2]!.state.knowledge.cores.kinetics!.supports["rate-observation"]!.status).toBe("valid");
  });
});
