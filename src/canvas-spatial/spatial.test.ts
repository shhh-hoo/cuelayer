import { describe, expect, it } from "vitest";
import { M4A_GROUNDED_LEARNER_PROJECTION_FIXTURES } from "../learner-projection/grounded-fixtures.ts";
import { SCENARIOS, fixture } from "../dev/m4b-canvas/scenarios.ts";
import { advanceSpatial, coreRef, emptySpatial, measureSpatial, objectRef, rectOf, rendererId, semanticKey, transientKey } from "./spatial.ts";
import { attentionFrame, projectCanvas } from "./canvas-projection.ts";
import { overlaps } from "./geometry.ts";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const scenario = (id: string) => SCENARIOS.find(s => s.id === id)!;
const initialized = (id: string) => {
  const item = fixture(id);
  return { item, spatial: advanceSpatial(emptySpatial(item.input.state.sessionId), item.input.state, item.expected) };
};

describe("spatial memory and authority", () => {
  it.each(SCENARIOS)("$title preserves established coordinates and has no automatic node overlaps", s => {
    let spatial = emptySpatial(s.steps[0]!.state.sessionId);
    for (const step of s.steps) {
      const input = JSON.stringify([step.state, step.projection]);
      freeze(step.state); freeze(step.projection); freeze(spatial);
      const next = advanceSpatial(spatial, step.state, step.projection);
      const repeated = advanceSpatial(spatial, step.state, step.projection);
      expect(next).toEqual(repeated);
      for (const [key, element] of Object.entries(spatial.elements)) if (next.elements[key]) {
        expect(next.elements[key]!.position, `established ${key}`).toEqual(element.position);
      }
      expect(JSON.stringify([step.state, step.projection])).toBe(input);
      const nodes = projectCanvas(step.state, step.projection, next).nodes;
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        expect(overlaps(rectOf(next.elements[nodes[i]!.data.spatialKey]!), rectOf(next.elements[nodes[j]!.data.spatialKey]!), 0), `${nodes[i]!.data.text} / ${nodes[j]!.data.text}`).toBe(false);
      }
      spatial = next;
    }
  });

  it.each(M4A_GROUNDED_LEARNER_PROJECTION_FIXTURES)("consumes approved M4A $id without mutation or overlapping rectangles", item => {
    freeze(item);
    const spatial = advanceSpatial(emptySpatial(item.input.state.sessionId), item.input.state, item.expected);
    const nodes = projectCanvas(item.input.state, item.expected, spatial).nodes;
    expect(nodes.length).toBeGreaterThan(0);
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      expect(overlaps(rectOf(spatial.elements[nodes[i]!.data.spatialKey]!), rectOf(spatial.elements[nodes[j]!.data.spatialKey]!), 0)).toBe(false);
    }
  });

  it("places a connected multi-node addition beside its established neighborhood without globally relaying A/B", () => {
    const steps = scenario("growth").steps;
    const state = structuredClone(steps[1]!.state);
    const core = state.knowledge.cores.catalysts!;
    const before = advanceSpatial(emptySpatial(state.sessionId), state, steps[1]!.projection);
    for (const id of ["c", "d"]) core.objects[id] = { ...structuredClone(core.objects.catalyst!), id };
    for (const [id, from, to] of [["bc", "alternative-path", "c"], ["cd", "c", "d"]]) {
      core.relations[id!] = { id: id!, status: "valid", value: { ...core.objects.catalyst!.value, fromObjectId: from!, toObjectId: to! } };
    }
    const after = advanceSpatial(before, state, steps[1]!.projection);
    for (const key of Object.keys(before.elements)) expect(after.elements[key]).toEqual(before.elements[key]);
    const c = after.elements[semanticKey(state.sessionId, objectRef("catalysts", "c"))]!;
    const d = after.elements[semanticKey(state.sessionId, objectRef("catalysts", "d"))]!;
    expect(d.position.y).toBeGreaterThan(c.position.y);
    for (const node of Object.values(before.elements)) { expect(overlaps(rectOf(c), rectOf(node), 0)).toBe(false); expect(overlaps(rectOf(d), rectOf(node), 0)).toBe(false); }
  });

  it("preserves new/parked/refocused Core origins and does not duplicate their nodes", () => {
    const steps = scenario("shared-inspection").steps;
    let spatial = emptySpatial(steps[0]!.state.sessionId);
    for (const step of steps.slice(0, 3)) spatial = advanceSpatial(spatial, step.state, step.projection);
    const origin = spatial.coreOrigins.catalysts;
    for (const step of steps.slice(3)) {
      spatial = advanceSpatial(spatial, step.state, step.projection);
      expect(spatial.coreOrigins.catalysts).toEqual(origin);
      expect(spatial.coreOrigins.arrhenius).not.toEqual(origin);
    }
    expect(Object.keys(spatial.coreOrigins)).toHaveLength(2);
    expect(Object.values(spatial.elements).filter(e => e.kind === "OBJECT" && e.coreId === "catalysts")).toHaveLength(3);
  });

  it("switches an object representation in place with the same renderer ID", () => {
    const [text, equation] = scenario("representation").steps;
    const before = advanceSpatial(emptySpatial(text!.state.sessionId), text!.state, text!.projection);
    const after = advanceSpatial(before, equation!.state, equation!.projection);
    const key = semanticKey(text!.state.sessionId, objectRef("ionisation", "definition"));
    expect(after.elements[key]).toEqual(before.elements[key]);
    const node = projectCanvas(equation!.state, equation!.projection, after).nodes.find(n => n.data.spatialKey === key)!;
    expect(node.id).toBe(rendererId(key));
    expect(node.data.label).toBe("CHEMICAL_EQUATION");
    expect(Object.values(after.elements).filter(e => e.kind === "OBJECT")).toHaveLength(2);
  });

  it("retains transient coordinates through updates and forgets only Work geometry on removal", () => {
    const [before, active, settled, removed] = scenario("work").steps;
    let spatial = advanceSpatial(emptySpatial(before!.state.sessionId), before!.state, before!.projection);
    const established = spatial;
    spatial = advanceSpatial(spatial, active!.state, active!.projection);
    const key = transientKey(active!.state.sessionId, "WORK", "dry-run-table");
    const position = spatial.elements[key]!.position;
    spatial = advanceSpatial(spatial, settled!.state, settled!.projection);
    expect(spatial.elements[key]!.position).toEqual(position);
    spatial = advanceSpatial(spatial, removed!.state, removed!.projection);
    expect(spatial.elements[key]).toBeUndefined();
    expect(spatial).toEqual(established);
    expect(removed!.state).toBe(before!.state);
  });

  it("omits Support visually while retaining accepted Support and its geometry for inspection", () => {
    const [visible, hidden] = scenario("support").steps;
    const spatial = advanceSpatial(emptySpatial(visible!.state.sessionId), visible!.state, visible!.projection);
    const next = advanceSpatial(spatial, hidden!.state, hidden!.projection);
    const key = semanticKey(visible!.state.sessionId, { kind: "SUPPORT", coreId: "kinetics", id: "rate-observation" });
    expect(next.elements[key]).toEqual(spatial.elements[key]);
    expect(projectCanvas(hidden!.state, hidden!.projection, next).nodes.some(n => n.data.spatialKey === key)).toBe(false);
    expect(projectCanvas(hidden!.state, hidden!.projection, next, "kinetics").nodes.some(n => n.data.spatialKey === key)).toBe(true);
    expect(hidden!.state.knowledge.cores.kinetics!.supports["rate-observation"]).toBeDefined();
  });

  it("uses retained measurements for future collision tests without moving established geometry", () => {
    const [first, added] = scenario("growth").steps;
    const before = advanceSpatial(emptySpatial(first!.state.sessionId), first!.state, first!.projection);
    const key = semanticKey(first!.state.sessionId, objectRef("catalysts", "catalyst"));
    const measured = measureSpatial(before, key, { width: 350, height: 240 });
    expect(measureSpatial(measured, key, { width: 350, height: 240 })).toBe(measured);
    const next = advanceSpatial(measured, added!.state, added!.projection);
    expect(next.elements[key]!.position).toEqual(before.elements[key]!.position);
    expect(next.elements[key]!.measured).toEqual({ width: 350, height: 240 });
    const newKey = semanticKey(first!.state.sessionId, objectRef("catalysts", "alternative-path"));
    expect(overlaps(rectOf(next.elements[key]!), rectOf(next.elements[newKey]!), 0)).toBe(false);
  });

  it("keeps identities independent of text, array order, session and renderer IDs", () => {
    const { item, spatial } = initialized("cambridge-ionisation-representation-switch");
    const state = structuredClone(item.input.state);
    state.knowledge.cores.ionisation!.objects.definition!.value.text = "Revised definition";
    state.knowledge.cores.ionisation!.objects = Object.fromEntries(Object.entries(state.knowledge.cores.ionisation!.objects).reverse());
    const next = advanceSpatial(spatial, state, item.expected);
    expect(next).toEqual(spatial);
    const key = semanticKey(state.sessionId, objectRef("ionisation", "definition"));
    expect(rendererId(key)).not.toBe(key);
    expect(rendererId(key)).not.toBe("definition");
    expect(semanticKey("another-lesson", objectRef("ionisation", "definition"))).not.toBe(key);
    state.sessionId = "another-lesson";
    const reset = advanceSpatial(spatial, state, item.expected);
    expect(reset.elements[key]).toBeUndefined();
  });

  it("does not allocate phantom domain elements for multiple representations of the same target", () => {
    const { item, spatial } = initialized("history-contemporary-sources-competing-interpretations");
    expect(Object.values(spatial.elements).filter(e => e.kind === "OBJECT")).toHaveLength(3);
    expect(Object.values(spatial.elements).filter(e => e.kind === "REPRESENTATION")).toHaveLength(2);
    const frame = attentionFrame(item.input.state, item.expected, spatial);
    for (const id of ["source-a", "source-b"]) expect(frame.primary).toContainEqual(rectOf(spatial.elements[transientKey(item.input.state.sessionId, "REPRESENTATION", id)]!));
  });

  it("WIDEN includes selected cross-Core context without fitting all Parked knowledge", () => {
    const { item, spatial } = initialized("rsc-group2-review-widen");
    const frame = attentionFrame(item.input.state, item.expected, spatial);
    const key = (id: string) => semanticKey(item.input.state.sessionId, objectRef("periodicity", id));
    expect(frame.all).toContainEqual(rectOf(spatial.elements[key("ionisation-trend")]!));
    expect(frame.all).not.toContainEqual(rectOf(spatial.elements[key("atomic-radius")]!));
    expect(frame.all).toContainEqual(rectOf(spatial.elements[semanticKey(item.input.state.sessionId, coreRef("group2"))]!));
  });
});
