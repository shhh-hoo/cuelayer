import { describe, expect, it, vi } from "vitest";
import { overlaps } from "../../canvas-spatial/geometry.ts";
import { rendererId, semanticKey, transientKey } from "../../canvas-spatial/spatial.ts";
import * as spatialAdapter from "../../canvas-spatial/spatial.ts";
import * as canvasProjection from "../../canvas-spatial/canvas-projection.ts";
import { M4A_GROUNDED_LEARNER_PROJECTION_FIXTURES } from "../../learner-projection/grounded-fixtures.ts";
import { CHOREOGRAPHY_SCENARIOS, type ChoreographyStep } from "./scenarios.ts";
import { acceptFrame, acceptHomes, emptyChoreography, emptyHomes, inspectCoreFrame, inspectFrame, resumeFrame, teachingScene,
  temporaryPlacement, type HomeGeometry, type Measurements, type TeachingFrame, type TeachingScene } from "./model.ts";

const scenario = (id: string) => CHOREOGRAPHY_SCENARIOS.find(item => item.id === id)!;
const step = (id: string, label: string) => scenario(id).steps.find(item => item.label === label)!;
const copy = <T,>(value: T): T => structuredClone(value);
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// Explicit deterministic rectangles exercise state/identity invariants only.
// These are not DOM measurements or evidence of projector readability; the
// browser review must independently measure the actual rendered typography.
const measured = (scene: TeachingScene): Measurements => Object.fromEntries(scene.items.map(item => [item.id,
  { width: 352, height: item.kind === "CORE" ? 52 : item.text.length > 600 ? 960 : 136 }]));
const frame = (item: ChoreographyStep, positions: TeachingFrame["positions"] = {}): TeachingFrame => {
  const scene = teachingScene(item);
  return { scene, positions, sizes: measured(scene), solveMs: 1, notes: ["Deterministic test measurements; no browser readability claim."] };
};
const idFor = (item: ChoreographyStep, coreId: string, id: string) => rendererId(semanticKey(item.state.sessionId, { kind: "OBJECT", coreId, id }));

describe("choreography model contract", () => {
  it("preserves legacy renderer metadata with a geometry-free catalog for all choreography and grounded M4A inputs", () => {
    const inputs: ChoreographyStep[] = [
      ...CHOREOGRAPHY_SCENARIOS.flatMap(item => item.steps),
      ...M4A_GROUNDED_LEARNER_PROJECTION_FIXTURES.map(item => ({ label: item.id, state: item.input.state, projection: item.expected })),
    ];
    const originalProject = canvasProjection.projectCanvas;
    let observed: ReturnType<typeof originalProject> | undefined;
    let catalog: spatialAdapter.SpatialState | undefined;
    const projection = vi.spyOn(canvasProjection, "projectCanvas").mockImplementation((state, attention, spatial, inspected) => {
      catalog = spatial;
      observed = originalProject(state, attention, spatial, inspected);
      return observed;
    });
    const metadata = (render: ReturnType<typeof originalProject>) => ({
      nodes: render.nodes.map(node => ({ id: node.id, type: node.type, data: node.data, ariaLabel: node.ariaLabel })),
      edges: render.edges,
    });
    try {
      for (const input of inputs) for (const inspected of [undefined, ...Object.keys(input.state.knowledge.cores)]) {
        // Legacy layout is run only in this regression reference, never in the
        // choreography adapter, measurement or rendering path.
        const baseline = originalProject(input.state, input.projection,
          spatialAdapter.advanceSpatial(spatialAdapter.emptySpatial(input.state.sessionId), input.state, input.projection), inspected);
        teachingScene(input, inspected);
        expect(metadata(observed!)).toEqual(metadata(baseline));
        for (const element of Object.values(catalog!.elements)) {
          expect(element.position).toEqual({ x: 0, y: 0 });
          expect(element.size).toEqual({ width: 1, height: 1 });
        }
      }
    } finally { projection.mockRestore(); }
  });

  it("never invokes the legacy whole-world spatial pass when building a teaching scene", () => {
    const legacy = vi.spyOn(spatialAdapter, "advanceSpatial").mockImplementation(() => { throw new Error("Unexpected legacy layout call"); });
    try {
      for (const input of CHOREOGRAPHY_SCENARIOS.flatMap(item => item.steps)) expect(teachingScene(input).items.length).toBeGreaterThan(0);
      expect(legacy).not.toHaveBeenCalled();
    } finally { legacy.mockRestore(); }
  });

  it("derives renderer state without mutating frozen Core or M4A inputs", () => {
    for (const source of CHOREOGRAPHY_SCENARIOS.flatMap(item => item.steps)) {
      const input = freeze(copy(source));
      const serialized = JSON.stringify(input);
      const scene = teachingScene(input);
      const sizes = freeze(measured(scene));
      const homes = acceptHomes(freeze(emptyHomes()), scene, sizes);
      expect(JSON.stringify(input)).toBe(serialized);
      expect(Object.keys(homes.positions)).toEqual(expect.arrayContaining(scene.items.filter(item => item.durable).map(item => item.id)));
    }
  });

  it("keeps exact canonical selections, including both independent History representations", () => {
    const history = step("history-compare", "COMPARE · Interpretations and both sources");
    const scene = teachingScene(history);
    expect(scene.primary.sort()).toEqual([
      idFor(history, "emancipation", "proclamation"), idFor(history, "emancipation", "interpretation-a"), idFor(history, "emancipation", "interpretation-b"),
      rendererId(transientKey(history.state.sessionId, "REPRESENTATION", "source-a")),
      rendererId(transientKey(history.state.sessionId, "REPRESENTATION", "source-b")),
    ].sort());
    expect(new Set(scene.items.map(item => item.id)).size).toBe(scene.items.length);
    expect(scene.items.filter(item => item.kind === "REPRESENTATION").every(item => item.text.includes("not supplied"))).toBe(true);
    const widen = teachingScene(step("teaching-story", "WIDEN · Two distant propositions"));
    expect(widen.required).toHaveLength(2);
    expect(widen.required).toEqual(expect.arrayContaining(widen.primary));
    expect(widen.items.filter(item => widen.required.includes(item.id)).map(item => item.coreId).sort()).toEqual(["arrhenius", "catalysts"]);
  });

  it("keeps real COMPARE necessary context in the required readable composition", () => {
    const trig = step("trig-compare", "COMPARE · Base and transformed sine");
    const scene = teachingScene(trig);
    expect(scene.primary).toHaveLength(2);
    expect(scene.required).toEqual(expect.arrayContaining([
      ...scene.primary, idFor(trig, "trig-graphs", "equivalent-form"),
    ]));
    expect(scene.required.some(id => scene.items.find(item => item.id === id)?.kind === "WORK")).toBe(false);
  });

  it("accepts HOME and FOCUS frames with zero temporary positions and releases a prior composition", () => {
    const widening = frame(step("teaching-story", "WIDEN · Two distant propositions"));
    widening.positions = Object.fromEntries(widening.scene.required.map((id, index) => [id, { x: 100 + index * 400, y: -300 }]));
    let state = acceptFrame(emptyChoreography(), widening);
    const focus = frame(step("teaching-story", "FOCUS · Return selected objects home"));
    state = acceptFrame(state, focus);
    expect(state.visible?.scene.framing).toBe("FOCUS");
    expect(state.visible?.positions).toEqual({});
    const home = frame(step("teaching-story", "HOME · Catalyst Option 2"));
    state = acceptFrame(state, home);
    expect(state.visible?.scene.framing).toBe("HOME");
    expect(state.visible?.positions).toEqual({});
  });

  it("keeps established home coordinates byte-for-byte while accepting a complete story and a long revision", () => {
    let homes = emptyHomes();
    const accepted = [...scenario("teaching-story").steps, ...scenario("long-text").steps];
    for (const input of accepted) {
      const old = freeze(copy(homes));
      const scene = teachingScene(input);
      homes = acceptHomes(old, scene, measured(scene));
      const oldKeys = Object.keys(old.positions);
      expect(JSON.stringify(Object.fromEntries(oldKeys.map(id => [id, homes.positions[id]])))).toBe(JSON.stringify(old.positions));
      expect(Object.fromEntries(Object.keys(old.coreOrigins).map(id => [id, homes.coreOrigins[id]]))).toEqual(old.coreOrigins);
    }
    const long = step("long-text", "WIDEN · Recompose the measured long text");
    const revisedId = idFor(long, "catalysts", "lower-ea");
    expect(homes.sizes[revisedId]!.height).toBe(960);
    const originalScene = teachingScene(step("teaching-story", "HOME · Catalyst Option 2"));
    const originalHomes = acceptHomes(emptyHomes(), originalScene, measured(originalScene));
    expect(homes.positions[revisedId]).toEqual(originalHomes.positions[revisedId]);
  });

  it("places only selected presentation objects without rewriting home or accepted solver output", () => {
    const input = step("teaching-story", "WIDEN · Two distant propositions");
    const scene = teachingScene(input);
    const sizes = measured(scene);
    const homes = freeze(acceptHomes(emptyHomes(), scene, sizes));
    const selected = scene.items.filter(item => scene.required.includes(item.id));
    const result = freeze({ positions: Object.fromEntries(selected.map((item, index) => [item.id, { x: index * 400, y: 0 }])), elapsedMs: 1, notes: [] });
    const before = JSON.stringify({ homes, result, input });
    const temporary = temporaryPlacement(result, selected, sizes, homes, scene);
    expect(Object.keys(temporary).sort()).toEqual(scene.required.slice().sort());
    expect(JSON.stringify({ homes, result, input })).toBe(before);
    const [a, b] = selected;
    expect(overlaps({ ...temporary[a!.id]!, ...sizes[a!.id]! }, { ...temporary[b!.id]!, ...sizes[b!.id]! }, 24)).toBe(false);
  });

  it.each(["inspection", "preserve"] as const)("prunes invalid and removed objects while %s holds the remaining composition", mode => {
    const original = copy(step("teaching-story", "WIDEN · Two distant propositions"));
    const visible = frame(original);
    visible.positions = Object.fromEntries(visible.scene.required.map((id, index) => [id, { x: index * 400, y: -200 }]));
    let state = acceptFrame(emptyChoreography(), visible);
    if (mode === "inspection") state = inspectFrame(state);
    const updated = copy(original);
    updated.state.knowledge.cores.catalysts!.objects["lower-ea"]!.status = "invalidated";
    delete updated.state.knowledge.cores.catalysts!.objects.catalyst;
    if (mode === "preserve") updated.projection.projector = "PRESERVE_VIEW";
    const invalidId = idFor(original, "catalysts", "lower-ea");
    const removedId = idFor(original, "catalysts", "catalyst");
    state = acceptFrame(state, frame(updated));
    expect(state.visible?.scene.items.some(item => [invalidId, removedId].includes(item.id))).toBe(false);
    expect(state.visible?.scene.required).not.toContain(invalidId);
    expect(state.visible?.positions[invalidId]).toBeUndefined();
    expect(state.visible?.sizes[invalidId]).toBeUndefined();
    expect(state.visible?.scene.edges.some(edge => [edge.source, edge.target].includes(invalidId))).toBe(false);
    const surviving = visible.scene.primary[0]!;
    expect(state.visible?.positions[surviving]).toEqual(visible.positions[surviving]);
  });

  it.each(["inspection", "preserve"] as const)("prunes invalidated relations with still-valid endpoints during %s", mode => {
    const original = copy(step("teaching-story", "HOME · Catalyst Option 2"));
    let state = acceptFrame(emptyChoreography(), frame(original));
    expect(state.visible?.scene.edges).toHaveLength(1);
    if (mode === "inspection") state = inspectFrame(state);
    const updated = copy(original);
    updated.state.knowledge.cores.catalysts!.relations["path-ea"]!.status = "invalidated";
    if (mode === "preserve") updated.projection.projector = "PRESERVE_VIEW";
    state = acceptFrame(state, frame(updated));
    expect(state.visible?.scene.items.filter(item => item.kind === "OBJECT")).toHaveLength(3);
    expect(state.visible?.scene.edges).toEqual([]);
  });

  it("retains latest accepted teaching separately and resumes it directly without replaying intermediate compositions", () => {
    const first = frame(step("teaching-story", "WIDEN · Two distant propositions"));
    first.positions = Object.fromEntries(first.scene.required.map((id, index) => [id, { x: 50 + index * 400, y: -220 }]));
    let state = inspectFrame(acceptFrame(emptyChoreography(), first));
    const progress = frame(step("teaching-story", "WIDEN · Teaching explanation progresses"));
    progress.positions = Object.fromEntries(progress.scene.required.map((id, index) => [id, { x: index * 500, y: -340 }]));
    state = acceptFrame(state, progress);
    expect(state.mode).toBe("TEACHER_INSPECTION");
    expect(state.visible?.positions).toEqual(first.positions);
    expect(state.latest).toBe(progress);
    const newest = frame(step("teaching-story", "Accepted semantic refocus · Catalysts"));
    state = acceptFrame(state, newest);
    expect(state.visible?.scene.currentCoreId).toBe("arrhenius");
    expect(state.latest?.scene.currentCoreId).toBe("catalysts");
    const resumed = resumeFrame(state);
    expect(resumed.mode).toBe("AUTO_FOLLOW");
    expect(resumed.visible).toBe(newest);
    expect(resumed.visible?.positions).toEqual({});
    expect(resumed.visible?.scene.primary).toEqual(newest.scene.primary);
  });

  it("holds the displayed content and positions on PRESERVE_VIEW, and applies its latest accepted revision on explicit Follow", () => {
    const first = frame(step("long-text", "WIDEN · Before the long revision"));
    first.positions = Object.fromEntries(first.scene.required.map((id, index) => [id, { x: index * 400, y: -220 }]));
    const next = frame(step("long-text", "PRESERVE_VIEW · Long accepted text, positions held"));
    const state = acceptFrame(acceptFrame(emptyChoreography(), first), next);
    const objectId = idFor(step("long-text", "WIDEN · Before the long revision"), "catalysts", "lower-ea");
    expect(state.visible?.positions).toEqual(first.positions);
    expect(state.visible?.scene.items.find(item => item.id === objectId)?.text).toHaveLength(54);
    expect(state.latest?.scene.items.find(item => item.id === objectId)!.text.length).toBeGreaterThan(600);
    expect(resumeFrame(state).visible).toBe(next);
  });

  it("never gives transient Work a home, including settlement and removal", () => {
    let homes: HomeGeometry = emptyHomes();
    const workIds = new Set<string>();
    for (const item of scenario("work").steps) {
      const scene = teachingScene(item);
      for (const work of scene.items.filter(entry => entry.kind === "WORK")) {
        workIds.add(work.id);
        expect(work.durable).toBe(false);
      }
      homes = acceptHomes(homes, scene, measured(scene));
    }
    expect(workIds.size).toBe(1);
    for (const id of workIds) {
      expect(homes.positions[id]).toBeUndefined();
      expect(homes.sizes[id]).toBeUndefined();
    }
  });

  it("removes expired transient Work from an inspected composition without deleting knowledge", () => {
    const work = scenario("work").steps;
    const inProgress = frame(work[1]!);
    const workId = inProgress.scene.items.find(item => item.kind === "WORK")!.id;
    inProgress.positions[workId] = { x: 800, y: 100 };
    const held = inspectFrame(acceptFrame(emptyChoreography(), inProgress));
    const state = acceptFrame(held, frame(work[3]!));
    expect(state.mode).toBe("TEACHER_INSPECTION");
    expect(state.visible?.scene.items.some(item => item.id === workId)).toBe(false);
    expect(state.visible?.positions[workId]).toBeUndefined();
    expect(state.visible?.sizes[workId]).toBeUndefined();
    expect(state.visible?.scene.items.filter(item => item.durable).map(item => item.id)).toEqual(inProgress.scene.items.filter(item => item.durable).map(item => item.id));
  });

  it("records hidden retained Support home geometry without selecting or showing it until explicit Core inspection", () => {
    const omitted = scenario("support").steps[1]!;
    const hidden = teachingScene(omitted);
    const support = hidden.items.find(item => item.kind === "SUPPORT")!;
    expect(support.visible).toBe(false);
    expect(support.durable).toBe(true);
    expect(hidden.required).not.toContain(support.id);
    expect(hidden.primary).not.toContain(support.id);
    const homes = acceptHomes(emptyHomes(), hidden, measured(hidden));
    expect(homes.positions[support.id]).toBeDefined();
    const inspected = teachingScene(omitted, "kinetics");
    expect(inspected.items.find(item => item.id === support.id)?.visible).toBe(true);
    const inspectedHomes = acceptHomes(homes, inspected, measured(inspected));
    expect(inspectedHomes.positions[support.id]).toEqual(homes.positions[support.id]);
    expect(omitted.state.knowledge.cores.kinetics!.supports["rate-observation"]!.status).toBe("valid");
  });

  it("explicitly reviews a newly accepted Core during inspection while preserving held objects and latest teaching", () => {
    const catalyst = frame(step("teaching-story", "HOME · Catalyst Option 2"));
    catalyst.compact = false;
    let homes = acceptHomes(emptyHomes(), catalyst.scene, catalyst.sizes);
    catalyst.positions = copy(homes.positions);
    const newer = frame(step("teaching-story", "WIDEN · Two distant propositions"));
    newer.compact = false;
    homes = acceptHomes(homes, newer.scene, newer.sizes);
    newer.positions = Object.fromEntries(newer.scene.required.map((id, index) => [id, { x: index * 400, y: -999 }]));
    const held = acceptFrame(inspectFrame(acceptFrame(emptyChoreography(), catalyst)), newer);
    expect(held.visible?.scene.items.some(item => item.coreId === "arrhenius")).toBe(false);
    const original = JSON.stringify(held);
    const reviewed = inspectCoreFrame(freeze(held), "arrhenius");
    expect(JSON.stringify(held)).toBe(original);
    expect(reviewed.mode).toBe("TEACHER_INSPECTION");
    expect(reviewed.latest).toBe(newer);
    expect(reviewed.visible?.inspectedCoreId).toBe("arrhenius");
    expect(reviewed.visible?.scene.currentCoreId).toBe(catalyst.scene.currentCoreId);
    const incoming = newer.scene.items.filter(item => item.coreId === "arrhenius" && item.durable);
    for (const item of incoming) {
      expect(reviewed.visible?.scene.items.find(current => current.id === item.id)).toMatchObject({ id: item.id, text: item.text, visible: true });
      expect(reviewed.visible?.positions[item.id]).toBeUndefined();
      expect(reviewed.visible?.positions[item.id] ?? homes.positions[item.id]).toEqual(homes.positions[item.id]);
      expect(homes.positions[item.id]).toBeDefined();
    }
    for (const [id, position] of Object.entries(catalyst.positions)) expect(reviewed.visible?.positions[id]).toEqual(position);
    expect(new Set(reviewed.visible!.scene.items.map(item => item.id)).size).toBe(reviewed.visible!.scene.items.length);
    expect(reviewed.visible?.scene.edges.some(edge => incoming.some(item => item.id === edge.source))).toBe(true);
    expect(resumeFrame(reviewed).visible).toBe(newer);
    expect(resumeFrame(reviewed).visible?.inspectedCoreId).toBeUndefined();
  });

  it("refreshes a reviewed canonical object's text without moving it or duplicating it", () => {
    const first = frame(step("teaching-story", "WIDEN · Two distant propositions"));
    const second = frame(step("teaching-story", "WIDEN · Teaching explanation progresses"));
    const id = first.scene.primary[0]!;
    first.positions = { [id]: { x: 64, y: -320 } };
    const held = acceptFrame(inspectFrame(acceptFrame(emptyChoreography(), first)), second);
    const reviewed = inspectCoreFrame(held, "arrhenius");
    expect(reviewed.visible?.positions[id]).toEqual(first.positions[id]);
    expect(reviewed.visible?.scene.items.filter(item => item.id === id)).toHaveLength(1);
    expect(reviewed.visible?.scene.items.find(item => item.id === id)?.text).toBe(second.scene.items.find(item => item.id === id)?.text);
    expect(reviewed.latest).toBe(second);
  });

  it("reveals retained Support for explicit review and holds the measured typography until Follow", () => {
    const hidden = frame(scenario("support").steps[1]!);
    hidden.compact = false;
    const narrowLatest = { ...copy(hidden), compact: true };
    const support = hidden.scene.items.find(item => item.kind === "SUPPORT")!;
    narrowLatest.sizes[support.id] = { width: 350, height: 200 };
    const held = acceptFrame(inspectFrame(acceptFrame(emptyChoreography(), hidden)), narrowLatest);
    const reviewed = inspectCoreFrame(held, "kinetics");
    expect(reviewed.visible?.compact).toBe(false);
    expect(reviewed.visible?.scene.items.find(item => item.id === support.id)?.visible).toBe(true);
    expect(reviewed.visible?.sizes[support.id]).toEqual(hidden.sizes[support.id]);
    expect(reviewed.visible?.positions[support.id]).toBeUndefined();
    expect(resumeFrame(reviewed).visible?.compact).toBe(true);
  });
});
