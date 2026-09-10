import { describe, expect, it } from "vitest";
import { rendererId, semanticKey } from "../../canvas-spatial/spatial.ts";
import { acceptFrame, emptyChoreography, inspectFrame, resumeFrame, teachingScene, type TeachingFrame } from "./model.ts";
import { isComposition, visualLayer } from "./presentation.ts";
import { CHOREOGRAPHY_SCENARIOS, type ChoreographyStep } from "./scenarios.ts";

const scenario = (id: string) => CHOREOGRAPHY_SCENARIOS.find(item => item.id === id)!;
const step = (id: string, label: string) => scenario(id).steps.find(item => item.label === label)!;
const frame = (input: ChoreographyStep): TeachingFrame => ({ scene: teachingScene(input), positions: {}, sizes: {}, solveMs: 0, notes: [] });
const item = (view: TeachingFrame, coreId: string, objectId: string) => view.scene.items.find(entry => entry.id === rendererId(semanticKey(
  scenario("teaching-story").steps[0]!.state.sessionId, { kind: "OBJECT", coreId, id: objectId })))!;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("focused choreography presentation state", () => {
  it.each(["COMPARE", "WIDEN", "FOCUS", "HOME"] as const)("recognizes %s independently of semantic role", framing => {
    const view = frame(step("teaching-story", "WIDEN · Two distant propositions"));
    view.scene.framing = framing;
    expect(isComposition(view)).toBe(framing === "COMPARE" || framing === "WIDEN");
  });

  it("keeps exact WIDEN primary and necessary context readable while suppressing unrelated homes", () => {
    const view = frame(step("teaching-story", "WIDEN · Two distant propositions"));
    expect(view.scene.required).toHaveLength(2);
    for (const selected of view.scene.items.filter(entry => view.scene.required.includes(entry.id))) expect(visualLayer(selected, view)).toBe("selected");
    for (const background of view.scene.items.filter(entry => entry.durable && !view.scene.required.includes(entry.id))) expect(visualLayer(background, view)).toBe("suppressed");
    expect(item(view, "catalysts", "lower-ea").role).toBe("context");
  });

  it("gives all real COMPARE co-primary targets equal selected legitimacy, including source identities", () => {
    for (const [id, label] of [["trig-compare", "COMPARE · Base and transformed sine"], ["history-compare", "COMPARE · Interpretations and both sources"]]) {
      const view = frame(step(id!, label!));
      for (const primaryId of view.scene.primary) expect(visualLayer(view.scene.items.find(entry => entry.id === primaryId)!, view)).toBe("selected");
      for (const requiredId of view.scene.required) expect(visualLayer(view.scene.items.find(entry => entry.id === requiredId)!, view)).toBe("selected");
      expect(new Set(view.scene.items.map(entry => entry.id)).size).toBe(view.scene.items.length);
    }
  });

  it("reveals only the explicitly reviewed Core behind an active composition", () => {
    const view = frame(step("teaching-story", "WIDEN · Two distant propositions"));
    view.inspectedCoreId = "catalysts";
    expect(visualLayer(item(view, "catalysts", "catalyst"), view)).toBe("review");
    expect(visualLayer(item(view, "catalysts", "lower-ea"), view)).toBe("selected");
    expect(visualLayer(item(view, "arrhenius", "rate"), view)).toBe("suppressed");
  });

  it("holds attenuation through return using only traveling IDs while keeping newly accepted roles", () => {
    const previous = frame(step("teaching-story", "WIDEN · Two distant propositions"));
    const returning = freeze([...previous.scene.required]);
    const next = frame(step("teaching-story", "Accepted semantic refocus · Catalysts"));
    const definition = item(next, "catalysts", "catalyst");
    const lowerEa = item(next, "catalysts", "lower-ea");
    const unrelated = item(next, "catalysts", "alternative-path");
    expect(isComposition(next)).toBe(false);
    expect(visualLayer(definition, next, returning)).toBe("suppressed");
    expect(visualLayer(lowerEa, next, returning)).toBe("selected");
    expect(visualLayer(unrelated, next, returning)).toBe("suppressed");
    expect(definition.role).toBe("primary");
    expect(lowerEa.role).toBe("history");
    expect(visualLayer(lowerEa, next)).toBe("home");
    expect(visualLayer(unrelated, next)).toBe("home");
  });

  it("does not reveal HOME's entire current-Core camera target before the returning objects settle", () => {
    const previous = frame(step("teaching-story", "WIDEN · Two distant propositions"));
    const home = frame(step("teaching-story", "FOCUS · Return selected objects home"));
    home.scene.framing = "HOME";
    home.scene.required = home.scene.items.filter(entry => entry.visible && entry.durable && entry.coreId === home.scene.currentCoreId).map(entry => entry.id);
    const background = home.scene.items.filter(entry => home.scene.required.includes(entry.id) && !previous.scene.required.includes(entry.id));
    expect(background.length).toBeGreaterThan(0);
    for (const entry of background) {
      expect(visualLayer(entry, home, previous.scene.required)).toBe("suppressed");
      expect(visualLayer(entry, home)).toBe("home");
    }
    for (const id of previous.scene.required) expect(visualLayer(home.scene.items.find(entry => entry.id === id)!, home, previous.scene.required)).toBe("selected");
  });

  it("does not retain old primary styling through direct semantic refocus or change canonical identity", () => {
    const prior = frame(step("teaching-story", "HOME · Catalyst Option 2"));
    const refocus = frame(step("teaching-story", "Accepted semantic refocus · Catalysts"));
    const state = acceptFrame(acceptFrame(emptyChoreography(), prior), refocus);
    const lowerBefore = item(prior, "catalysts", "lower-ea");
    const lowerAfter = item(state.visible!, "catalysts", "lower-ea");
    expect(lowerBefore.role).toBe("primary");
    expect(lowerAfter.id).toBe(lowerBefore.id);
    expect(lowerAfter.role).toBe("history");
    expect(item(state.visible!, "catalysts", "catalyst").role).toBe("primary");
    expect(visualLayer(lowerAfter, state.visible!, [lowerBefore.id])).toBe("selected");
    expect(lowerAfter.role).toBe("history");
  });

  it("holds inspection styling while teaching advances, then Follow clears stale primary roles using newest accepted attention", () => {
    const prior = frame(step("teaching-story", "WIDEN · Two distant propositions"));
    const latest = frame(step("teaching-story", "Accepted semantic refocus · Catalysts"));
    const held = acceptFrame(inspectFrame(acceptFrame(emptyChoreography(), prior)), latest);
    const oldPrimaryId = prior.scene.primary[0]!;
    expect(held.mode).toBe("TEACHER_INSPECTION");
    expect(held.visible!.scene.items.find(entry => entry.id === oldPrimaryId)?.role).toBe("primary");
    expect(held.latest).toBe(latest);
    const resumed = resumeFrame(held);
    expect(resumed.visible).toBe(latest);
    expect(resumed.visible!.scene.items.find(entry => entry.id === oldPrimaryId)?.role).toBe("history");
    expect(item(resumed.visible!, "catalysts", "catalyst").role).toBe("primary");
    expect(item(resumed.visible!, "catalysts", "lower-ea").role).toBe("history");
    const beforeIds = prior.scene.items.map(entry => entry.id).sort();
    expect(resumed.visible!.scene.items.map(entry => entry.id).sort()).toEqual(beforeIds);
    expect(new Set(beforeIds).size).toBe(beforeIds.length);
  });

  it("keeps Work transient even if the historical attached option put it in required or returning IDs", () => {
    const view = frame(scenario("work").steps[1]!);
    const work = view.scene.items.find(entry => entry.kind === "WORK")!;
    const original = JSON.stringify(work);
    view.scene.required.push(work.id);
    for (const framing of ["HOME", "FOCUS", "WIDEN", "COMPARE"] as const) {
      view.scene.framing = framing;
      expect(visualLayer(work, view)).toBe("transient");
      expect(visualLayer(work, view, [work.id])).toBe("transient");
    }
    expect(JSON.stringify(work)).toBe(original);
    expect(work.durable).toBe(false);
  });

  it("keeps ordinary HOME and FOCUS durable items at their normal visual layer", () => {
    for (const label of ["HOME · Catalyst Option 2", "FOCUS · Return selected objects home"]) {
      const view = frame(step("teaching-story", label));
      for (const durable of view.scene.items.filter(entry => entry.durable)) expect(visualLayer(durable, view)).toBe("home");
    }
  });

  it("does not mutate frozen semantic/projection inputs, frame identity, visibility or roles for any visual layer", () => {
    for (const original of CHOREOGRAPHY_SCENARIOS.flatMap(entry => entry.steps)) {
      const input = freeze(structuredClone(original));
      const view = freeze(frame(input));
      const returning = freeze([...view.scene.required]);
      const before = JSON.stringify({ input, view, returning });
      for (const entry of view.scene.items) {
        visualLayer(entry, view);
        visualLayer(entry, view, returning);
      }
      expect(JSON.stringify({ input, view, returning })).toBe(before);
    }
  });
});
