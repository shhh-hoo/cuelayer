import { describe, expect, it } from "vitest";
import { SCENARIOS } from "../dev/m4b-canvas/scenarios.ts";
import { advanceSpatial, emptySpatial } from "./spatial.ts";
import { attentionFrame, type AttentionFrame } from "./canvas-projection.ts";
import { emptyProjector, followTeaching, inspectRegion, inspectViewport, MIN_AUTO_ZOOM, reframe, updateProjector } from "./projector.ts";

const desktop = { width: 1280, height: 720 };
const narrow = { width: 390, height: 844 };
const frame = (x = 0, y = 0): AttentionFrame => ({ all: [{ x, y, width: 256, height: 128 }], primary: [{ x, y, width: 256, height: 128 }], framing: "FOCUS" });

describe("shared-projector intent execution", () => {
  it("PRESERVE_VIEW never issues a command, even when content is far away", () => {
    const before = emptyProjector();
    const next = updateProjector(before, frame(10000), "PRESERVE_VIEW", desktop);
    expect(next.command).toBeUndefined();
    expect(next.state.viewport).toEqual(before.viewport);
    expect(next.state.latest).toEqual(frame(10000));
  });
  it("FOLLOW_ATTENTION pans only the required distance while preserving zoom", () => {
    const before = { ...emptyProjector(), viewport: { x: 0, y: 0, zoom: 1 } };
    const next = updateProjector(before, frame(1100, 100), "FOLLOW_ATTENTION", desktop);
    expect(next.command?.target).toEqual({ x: -124, y: 0, zoom: 1 });
  });
  it("does nothing when attention fits comfortably", () => {
    expect(updateProjector(emptyProjector(), frame(100, 100), "FOLLOW_ATTENTION", desktop).command).toBeUndefined();
  });
  it("ignores tiny corrections", () => {
    const before = { ...emptyProjector(), viewport: { x: 0, y: 0, zoom: 1 } };
    expect(updateProjector(before, frame(977, 100), "FOLLOW_ATTENTION", desktop).command).toBeUndefined();
  });
  it("does not restart an identical target during an in-flight transition", () => {
    const first = updateProjector(emptyProjector(), frame(1000), "REFRAME_ATTENTION", desktop);
    const intermediate = { ...first.state, viewport: { x: 1, y: 1, zoom: 0.9 } };
    expect(updateProjector(intermediate, frame(1000), "REFRAME_ATTENTION", desktop).command).toBeUndefined();
  });
  it("reduced motion executes the same target immediately", () => {
    const normal = updateProjector(emptyProjector(), frame(1000), "REFRAME_ATTENTION", desktop);
    const reduced = updateProjector(emptyProjector(), frame(1000), "REFRAME_ATTENTION", desktop, true);
    expect(normal.command?.duration).toBe(220);
    expect(reduced.command).toEqual({ target: normal.command!.target, duration: 0 });
  });
  it.each([desktop, narrow])("frames only relevant attention at $width × $height", surface => {
    const target = reframe(frame(4000), surface)!;
    expect(target.x + (4000 + 128) * target.zoom).toBeCloseTo(surface.width / 2);
    expect(target.zoom).toBeGreaterThanOrEqual(MIN_AUTO_ZOOM);
  });
  it("includes both co-primary targets in COMPARE", () => {
    const primary = [{ x: 0, y: 0, width: 256, height: 128 }, { x: 0, y: 160, width: 256, height: 128 }];
    const target = reframe({ all: primary, primary, framing: "COMPARE" }, narrow)!;
    for (const rect of primary) {
      expect(rect.x * target.zoom + target.x).toBeGreaterThanOrEqual(20);
      expect((rect.y + rect.height) * target.zoom + target.y).toBeLessThanOrEqual(narrow.height - 20);
    }
  });
  it("keeps every History co-primary target readable in a narrow harness viewport", () => {
    const scenario = SCENARIOS.find(s => s.id === "compare")!;
    let spatial = emptySpatial(scenario.steps[0]!.state.sessionId);
    for (const step of scenario.steps) spatial = advanceSpatial(spatial, step.state, step.projection);
    const step = scenario.steps.at(-1)!;
    const frame = attentionFrame(step.state, step.projection, spatial);
    const surface = { width: 390, height: 520 };
    const camera = reframe(frame, surface)!;
    expect(camera.zoom).toBeGreaterThanOrEqual(MIN_AUTO_ZOOM);
    for (const rect of frame.primary) {
      expect(rect.x * camera.zoom + camera.x).toBeGreaterThanOrEqual(0);
      expect((rect.x + rect.width) * camera.zoom + camera.x).toBeLessThanOrEqual(surface.width);
      expect(rect.y * camera.zoom + camera.y).toBeGreaterThanOrEqual(0);
      expect((rect.y + rect.height) * camera.zoom + camera.y).toBeLessThanOrEqual(surface.height);
    }
  });
  it("never turns a broad WIDEN into unreadable miniatures", () => {
    const target = reframe({ ...frame(), all: [...frame().all, ...frame(10000).all], framing: "WIDEN" }, narrow)!;
    expect(target.zoom).toBeGreaterThanOrEqual(MIN_AUTO_ZOOM);
  });
  it.each(["pan", "zoom"])("manual %s enters inspection without a semantic setter", gesture => {
    const next = inspectViewport(emptyProjector(), { x: -500, y: 60, zoom: gesture === "zoom" ? 0.8 : 1 });
    expect(next.mode).toBe("TEACHER_INSPECTION");
    expect(Object.keys(next).sort()).toEqual(["lastTarget", "mode", "viewport"]);
  });
  it("explicit Core jumps enter inspection", () => {
    const next = inspectRegion(emptyProjector(), frame(3000).all, desktop);
    expect(next.state.mode).toBe("TEACHER_INSPECTION");
    expect(next.command).toBeDefined();
  });
  it("all automatic intents are suppressed during inspection while latest attention keeps updating", () => {
    let state = inspectViewport(emptyProjector(), { x: 29, y: 87, zoom: 0.8 });
    for (const intent of ["PRESERVE_VIEW", "FOLLOW_ATTENTION", "REFRAME_ATTENTION"] as const) {
      const next = updateProjector(state, frame(9000), intent, desktop);
      expect(next.command).toBeUndefined();
      expect(next.state.viewport).toEqual(state.viewport);
      state = next.state;
    }
    expect(state.latest).toEqual(frame(9000));
  });
  it("Follow teaching exits inspection and directly reframes the latest accepted frame", () => {
    let state = inspectViewport(emptyProjector(), { x: 29, y: 87, zoom: 0.8 });
    state = updateProjector(state, frame(1000), "FOLLOW_ATTENTION", desktop).state;
    state = updateProjector(state, frame(3000), "PRESERVE_VIEW", desktop).state;
    const next = followTeaching(state, desktop);
    expect(next.state.mode).toBe("AUTO_FOLLOW");
    expect(next.command?.target).toEqual(reframe(frame(3000), desktop));
    expect(updateProjector(next.state, frame(9000), "FOLLOW_ATTENTION", desktop).command).toBeDefined();
  });
  it("inspection, ongoing Canvas growth and accepted semantic refocus stay independent", () => {
    const steps = SCENARIOS.find(s => s.id === "shared-inspection")!.steps;
    let spatial = emptySpatial(steps[0]!.state.sessionId);
    for (const step of steps.slice(0, 4)) spatial = advanceSpatial(spatial, step.state, step.projection);
    const catalystOrigin = spatial.coreOrigins.catalysts;
    const inspected = { x: 100, y: 40, zoom: 0.8 };
    let viewport = inspectViewport(emptyProjector(), inspected);
    const before = JSON.stringify(steps[3]!.state);
    const growing = steps[4]!;
    spatial = advanceSpatial(spatial, growing.state, growing.projection);
    viewport = updateProjector(viewport, attentionFrame(growing.state, growing.projection, spatial), growing.projection.projector, desktop).state;
    expect(growing.state.knowledge.currentCoreId).toBe("arrhenius");
    expect(Object.values(spatial.elements).filter(e => e.coreId === "arrhenius" && e.kind === "OBJECT")).toHaveLength(2);
    expect(viewport.viewport).toEqual(inspected);
    expect(JSON.stringify(steps[3]!.state)).toBe(before);
    const resumed = followTeaching(viewport, desktop);
    expect(resumed.command?.target).toEqual(reframe(attentionFrame(growing.state, growing.projection, spatial), desktop));
    const refocus = steps[5]!;
    spatial = advanceSpatial(spatial, refocus.state, refocus.projection);
    const during = updateProjector(viewport, attentionFrame(refocus.state, refocus.projection, spatial), refocus.projection.projector, desktop);
    expect(refocus.state.knowledge.currentCoreId).toBe("catalysts");
    expect(during.command).toBeUndefined();
    expect(during.state.viewport).toEqual(inspected);
    expect(spatial.coreOrigins.catalysts).toEqual(catalystOrigin);
    expect(Object.keys(spatial.coreOrigins)).toHaveLength(2);
    expect(followTeaching(during.state, desktop).state.mode).toBe("AUTO_FOLLOW");
  });
});
