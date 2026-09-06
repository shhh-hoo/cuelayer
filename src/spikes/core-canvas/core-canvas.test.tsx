import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FixtureContent } from "./CanvasNodes";
import { initialPlayback, playbackReducer, STEPS } from "./fixture";
import { applyOperation, lessonCounts, type Lesson } from "./model";
import { attentionBounds, projectCanvas } from "./projection";
import { boundsOf, coreBounds, emptySpatial, followCamera, moveSpatial, placeAdditions, supportPosition } from "./spatial";

function at(index: number) {
  let state = initialPlayback();
  for (let i = 0; i < index; i++) state = playbackReducer(state, { type: "next" });
  return state.lesson;
}
function positioned(index: number) {
  let spatial = emptySpatial();
  for (let i = 0; i <= index; i++) spatial = placeAdditions(at(i), spatial, 1440);
  return spatial;
}

describe("scripted Core knowledge", () => {
  it("appends structure while preserving earlier nodes, relations and snapshots", () => {
    const first = at(1);
    const before = structuredClone(first);
    const grown = applyOperation(first, STEPS[2]!.operation);
    expect(grown.cores[0]!.nodes.slice(0, 2)).toEqual(first.cores[0]!.nodes);
    expect(grown.cores[0]!.nodes[0]).toBe(first.cores[0]!.nodes[0]);
    expect(grown.cores[0]!.relations[0]).toBe(first.cores[0]!.relations[0]);
    expect(first).toEqual(before);
    expect(grown.cores).toHaveLength(1);
  });
  it("refines one node without replacing its identity or surrounding structure", () => {
    const before = at(3);
    const after = applyOperation(before, STEPS[4]!.operation);
    expect(after.cores[0]!.nodes.map(node => node.id)).toEqual(before.cores[0]!.nodes.map(node => node.id));
    expect(after.cores[0]!.nodes.at(-1)!.content).toEqual({ kind: "text", text: "lower activation energy (Ea)" });
    expect(after.cores[0]!.relations).toBe(before.cores[0]!.relations);
  });
  it("keeps both classifications, definitions and their contrast inside Catalyst", () => {
    const lesson = at(6);
    expect(lesson.cores).toHaveLength(1);
    expect(lesson.cores[0]!.nodes.map(node => node.id)).toEqual(["catalysts", "rate", "pathway", "energy", "homogeneous", "same-phase", "heterogeneous", "different-phases"]);
    expect(lesson.cores[0]!.relations).toContainEqual({ id: "phase-contrast", source: "same-phase", target: "different-phases", kind: "contrast" });
    expect(lesson.currentCoreId).toBe("catalyst");
    expect(lesson.supports).toEqual([]);
  });
  it("retains extras for this experiment without mutating the Core or imposing a capacity", () => {
    const before = at(6);
    let lesson = before;
    for (let i = 0; i < 7; i++) lesson = applyOperation(lesson, { kind: "support", support: { id: `example-${i}`, coreId: "catalyst", text: `Example ${i}` } });
    expect(lesson.cores).toBe(before.cores);
    expect(lesson.supports).toHaveLength(7);
  });
  it("parks Catalyst intact and changes current identity only on a new Core", () => {
    const before = at(8);
    const after = applyOperation(before, STEPS[9]!.operation);
    expect(after.cores[0]).toBe(before.cores[0]);
    expect(after.supports).toBe(before.supports);
    expect(after.currentCoreId).toBe("arrhenius");
    expect(lessonCounts(at(10))).toEqual({ nodes: 10, relations: 9, supports: 2, parked: 1 });
  });
});

describe("renderer-only positions and projection", () => {
  it("preserves every established position during growth, including manual anchors", () => {
    let spatial = positioned(1);
    spatial = moveSpatial(spatial, "rate", { x: -310, y: 240 });
    for (let index = 2; index <= 10; index++) {
      const before = structuredClone(spatial);
      spatial = placeAdditions(at(index), spatial, 1440);
      for (const [id, position] of Object.entries(before.positions)) expect(spatial.positions[id]).toEqual(position);
      for (const [id, origin] of Object.entries(before.coreOrigins)) expect(spatial.coreOrigins[id]).toEqual(origin);
      expect(Object.keys(spatial.sizes.rate!)).toEqual(["width", "height"]);
    }
  });
  it("keeps the fixture additions non-overlapping without relocating established nodes", () => {
    const lesson = at(6);
    const spatial = positioned(6);
    const nodes = lesson.cores[0]!.nodes;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = { ...spatial.positions[nodes[i]!.id]!, ...spatial.sizes[nodes[i]!.id]! };
      const b = { ...spatial.positions[nodes[j]!.id]!, ...spatial.sizes[nodes[j]!.id]! };
      expect(a.x >= b.x + b.width || b.x >= a.x + a.width || a.y >= b.y + b.height || b.y >= a.y + a.height).toBe(true);
    }
  });
  it("moves a whole Core via its origin only; projection never becomes domain truth", () => {
    const lesson = at(10);
    const before = structuredClone(lesson);
    const spatial = positioned(10);
    const moved = moveSpatial(spatial, "core:catalyst", { x: -2000, y: 400 });
    const projected = projectCanvas(lesson, moved, "catalyst");
    expect(moved.positions).toBe(spatial.positions);
    expect(projected.nodes.find(node => node.id === "core:catalyst")!.position).toEqual({ x: -2000, y: 400 });
    expect(projected.nodes.find(node => node.id === "catalysts")!.parentId).toBe("core:catalyst");
    expect(projected.nodes.every(node => node.measured?.width && node.measured?.height)).toBe(true);
    expect(lesson).toEqual(before);
    expect(lesson.currentCoreId).toBe("arrhenius");
    expect(projected.nodes.filter(node => node.type === "knowledge" && node.data.status === "parked")).toHaveLength(8);
    expect(projected.nodes.find(node => node.id === "catalysts")!.data.inspected).toBe(true);
  });
  it("puts the parked Core outside the focused viewport, while retaining its layout and Supports", () => {
    const lesson = at(10);
    const spatial = positioned(10);
    const bounds = boundsOf(attentionBounds(lesson, spatial, "arrhenius"));
    const camera = followCamera({ x: 0, y: 0, zoom: 1 }, { width: 1440, height: 800 }, bounds, bounds, true);
    const parked = coreBounds(lesson.cores[0]!, spatial);
    expect((parked.x + parked.width) * camera.zoom + camera.x).toBeLessThan(0);
    expect(spatial.positions.catalysts).toEqual(positioned(8).positions.catalysts);
    expect(projectCanvas(lesson, spatial, null).nodes.filter(node => node.type === "support")).toHaveLength(2);
  });
  it("displaces only Support spatially and keeps it beside, rather than on top of, the Core", () => {
    const lesson = at(8);
    const spatial = positioned(8);
    const core = lesson.cores[0]!;
    const current = supportPosition(core, spatial, 0);
    const earlier = supportPosition(core, spatial, 1);
    const bounds = coreBounds(core, spatial, false);
    expect(earlier.y).toBeLessThan(current.y);
    expect(current.x).toBeGreaterThan(bounds.x + bounds.width);
    expect(at(8).cores).toEqual(at(6).cores);
  });
  it("does not move a camera whose current content already fits; narrow views stay readable", () => {
    const camera = { x: 300, y: 200, zoom: 1 };
    const bounds = { x: 0, y: 0, width: 220, height: 84 };
    expect(followCamera(camera, { width: 1000, height: 700 }, bounds, bounds)).toBe(camera);
    const detail = { x: 1000, y: 400, width: 280, height: 84 };
    const narrow = followCamera(camera, { width: 390, height: 650 }, { x: 0, y: 0, width: 1600, height: 700 }, detail);
    expect(narrow.zoom).toBeGreaterThanOrEqual(0.6);
    expect(detail.x * narrow.zoom + narrow.x).toBeGreaterThanOrEqual(24);
    expect((detail.x + detail.width) * narrow.zoom + narrow.x).toBeLessThanOrEqual(390 - 24);
  });
  it("can return from history to the current Core without changing knowledge", () => {
    const lesson = at(10);
    const before: Lesson = structuredClone(lesson);
    const spatial = positioned(10);
    const history = boundsOf(attentionBounds(lesson, spatial, "catalyst"));
    const current = boundsOf(attentionBounds(lesson, spatial, lesson.currentCoreId));
    const size = { width: 1440, height: 800 };
    const inspecting = followCamera({ x: 0, y: 0, zoom: 1 }, size, history, history, true);
    const returned = followCamera(inspecting, size, current, current);
    expect(returned.x).not.toBe(inspecting.x);
    expect(lesson).toEqual(before);
  });
  it("can keep Core context and the latest Support together in a narrow attention region", () => {
    const lesson = at(8);
    const spatial = positioned(8);
    const context = { ...spatial.positions["different-phases"]!, ...spatial.sizes["different-phases"]! };
    const bounds = attentionBounds(lesson, spatial, "catalyst");
    const detail = boundsOf([context, bounds.at(-1)!]);
    const camera = followCamera({ x: 0, y: 0, zoom: 1 }, { width: 390, height: 700 }, boundsOf(bounds), detail);
    expect(context.x * camera.zoom + camera.x).toBeGreaterThanOrEqual(24);
    expect((detail.x + detail.width) * camera.zoom + camera.x).toBeLessThanOrEqual(366);
  });
});

it("renders the fixture exponential through existing KaTeX, including its accessible label", () => {
  const formula = at(10).cores[1]!.nodes[1]!.content;
  const html = renderToStaticMarkup(<FixtureContent content={formula} />);
  expect(html).toContain('data-notation-status="katex"');
  expect(html).toContain('class="katex"');
  expect(html).toContain("msup");
  expect(html).toContain("minus Ea over RT");
  expect(html).not.toContain("katex-error");
});
