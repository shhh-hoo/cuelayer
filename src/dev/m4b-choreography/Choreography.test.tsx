// @vitest-environment jsdom
import { act, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Point, Size, Viewport } from "../../canvas-spatial/geometry.ts";
import type { HomeGeometry, TeachingFrame, TeachingItem, TeachingScene } from "./model.ts";
import { teachingScene } from "./model.ts";
import { CHOREOGRAPHY_SCENARIOS } from "./scenarios.ts";
import Choreography from "./Choreography.tsx";

type FlowNode = { id: string; position: Point; style: { width: number }; data: TeachingItem & { layer: string } };
type FlowEdge = { id: string; markerEnd?: unknown; style: { opacity: number }; data: { path: string } };
const flow = vi.hoisted(() => ({ viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] as FlowNode[], edges: [] as FlowEdge[],
  setViewport: vi.fn(), getViewport: vi.fn() }));
const preparation = vi.hoisted(() => ({ deferredLabel: "", release: undefined as (() => void) | undefined }));

vi.mock("@xyflow/react", async importOriginal => ({
  getSmoothStepPath: (await importOriginal<typeof import("@xyflow/react")>()).getSmoothStepPath,
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  ViewportPortal: ({ children }: { children: ReactNode }) => children,
  BaseEdge: () => null, Handle: () => null,
  Position: { Left: "left", Right: "right" }, MarkerType: { Arrow: "arrow" },
  useReactFlow: () => ({ setViewport: flow.setViewport, getViewport: flow.getViewport }),
  ReactFlow: ({ children, nodes, edges, nodeTypes, onMoveStart, onMove, onMoveEnd }: {
    children: ReactNode; nodes: FlowNode[]; edges: FlowEdge[];
    nodeTypes: Record<string, ComponentType<{ data: FlowNode["data"] }>>;
    onMoveStart: (event: unknown) => void;
    onMove: (event: unknown, viewport: Viewport) => void; onMoveEnd: (event: unknown, viewport: Viewport) => void;
  }) => {
    flow.nodes = nodes; flow.edges = edges;
    const Knowledge = nodeTypes.knowledge!;
    return <div>{nodes.map(node => <Knowledge key={node.id} data={node.data} />)}{children}
      <button onClick={() => {
        const event = new MouseEvent("pointerdown"); onMoveStart(event);
        const viewport = { ...flow.viewport, x: flow.viewport.x + 200 };
        flow.viewport = viewport; onMove(event, viewport); onMoveEnd(event, viewport);
      }}>Simulate pan</button>
      <button onClick={() => { onMoveStart(null); onMove(null, flow.viewport); onMoveEnd(null, flow.viewport); }}>Programmatic viewport event</button>
    </div>;
  },
}));

// Deliberately explicit boxes and selected coordinates isolate component wiring
// from browser measurement and solver behavior. They do not prove readable fit.
vi.mock("./measurement.ts", async () => {
  const { acceptHomes } = await import("./model.ts");
  const measureItems = (items: TeachingItem[], width = 480, _compact = false, presentation = false) => Object.fromEntries(items.map(item =>
    [item.id, { width, height: (item.kind === "CORE" ? 60 : item.text.includes("The exponential factor becomes larger.") ? 120 : 80) + (presentation ? 28 : 0) }]));
  return {
    GAP: 32, measureItems,
    teachingFont: (item: TeachingItem) => item.kind === "CORE" ? 60 : 32,
    minimumFont: () => 28,
    readableRegion: (surface: Size) => ({ width: surface.width - 40, height: surface.height - 72 }),
    prepareTeachingFrame: (scene: TeachingScene, oldHomes: HomeGeometry, _surface: Size, _solver: string,
      _workMode: string, onHomes?: (homes: HomeGeometry) => void) => {
      const homeSizes = measureItems(scene.items), homes = acceptHomes(oldHomes, scene, homeSizes);
      onHomes?.(homes);
      const composition = scene.framing === "COMPARE" || scene.framing === "WIDEN";
      const sizes = { ...homeSizes, ...(composition ? measureItems(scene.items.filter(item => scene.required.includes(item.id)), 280, false, true) : {}) };
      const positions: Record<string, Point> = composition
        ? Object.fromEntries(scene.required.map((id, index) => [id, { x: 100 + index * 320, y: -200 }])) : {};
      for (const item of scene.items.filter(item => !item.durable && !positions[item.id])) positions[item.id] = { x: 100, y: 700 };
      const frame: TeachingFrame = { scene, positions, sizes, compact: false, solveMs: 0, notes: [] };
      const result = { homes, frame, measurementMs: 0 };
      return scene.label === preparation.deferredLabel
        ? new Promise(resolve => { preparation.release = () => resolve(result); }) : Promise.resolve(result);
    },
  };
});

type Diagnostic = { mode: string; framing: string; visibleStep: string; acceptedLatest: string;
  moving: boolean; returningIds: string[]; visualPhase: string; required: string[];
  homes: Record<string, Point>; positions: Record<string, Point>; measurements: Record<string, Size>; camera: Viewport };
const story = CHOREOGRAPHY_SCENARIOS.find(scenario => scenario.id === "teaching-story")!;
const originalInputs = JSON.stringify(CHOREOGRAPHY_SCENARIOS);
let root: Root, container: HTMLDivElement, time: number, nextAnimation: number;
let callbacks: Map<number, FrameRequestCallback>;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width: 1280, height: 520 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    disconnect() {}
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  time = 0; nextAnimation = 0; callbacks = new Map();
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callbacks.set(++nextAnimation, callback); return nextAnimation; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { callbacks.delete(id); });
  preparation.deferredLabel = ""; preparation.release = undefined;
  flow.viewport = { x: 0, y: 0, zoom: 1 }; flow.nodes = []; flow.edges = [];
  flow.setViewport.mockReset().mockImplementation((viewport: Viewport) => { flow.viewport = viewport; return Promise.resolve(true); });
  flow.getViewport.mockReset().mockImplementation(() => flow.viewport);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(<Choreography />); });
  await advance(1000);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  expect(JSON.stringify(CHOREOGRAPHY_SCENARIOS)).toBe(originalInputs);
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function diagnostic(): Diagnostic {
  return JSON.parse(container.querySelector("[data-choreography-diagnostics]")!.textContent!);
}
async function advance(milliseconds: number) {
  time += milliseconds;
  const scheduled = [...callbacks.values()]; callbacks.clear();
  await act(async () => { for (const callback of scheduled) callback(time); });
}
async function click(name: string) {
  const button = [...container.querySelectorAll("button")].find(item => item.textContent === name)!;
  expect(button, name).toBeDefined(); expect(button.disabled).toBe(false);
  await act(async () => button.click());
}
async function next(settle = true) { await click("Next"); if (settle) await advance(1000); }
async function widen() { for (let i = 0; i < 4; i++) await next(); }
function articles() {
  const elements = [...container.querySelectorAll<HTMLElement>("[data-canonical-id]")];
  const byId = new Map(elements.map(element => [element.dataset.canonicalId!, element]));
  expect(byId.size).toBe(elements.length);
  return byId;
}
function expectSameArticles(previous: Map<string, HTMLElement>) {
  const current = articles(); expect([...current.keys()]).toEqual([...previous.keys()]);
  for (const [id, element] of previous) expect(current.get(id), id).toBe(element);
}
function expectLayers(selected: string[]) {
  for (const node of flow.nodes.filter(node => node.data.durable)) {
    const expected = selected.includes(node.id) ? "selected" : "suppressed";
    expect(node.data.layer, node.id).toBe(expected);
    expect(articles().get(node.id)!.getAttribute("aria-hidden")).toBe(expected === "suppressed" ? "true" : null);
  }
}

it("moves the same HOME nodes into WIDEN and keeps unrelated content suppressed until their return settles", async () => {
  expect(diagnostic().framing).toBe("HOME");
  for (let i = 0; i < 3; i++) await next();
  const before = diagnostic(), mounted = articles();
  await next(false);
  const selected = diagnostic().required;
  expect(selected).toHaveLength(2);
  expect(diagnostic().positions).toEqual(before.positions);
  await advance(160);
  for (const id of selected) expect(diagnostic().positions[id]).not.toEqual(before.homes[id]);
  expectSameArticles(mounted); expectLayers(selected);
  await advance(1000);
  expect(diagnostic().visualPhase).toBe("composed");
  const presented = diagnostic().positions;
  await click("HOME");
  expect(diagnostic().positions).toEqual(presented);
  expect(diagnostic().returningIds).toEqual(selected);
  const visibleDuringReturn = selected;
  expectLayers(visibleDuringReturn);
  await advance(160);
  for (const id of selected) {
    expect(diagnostic().positions[id]).not.toEqual(presented[id]);
    expect(diagnostic().positions[id]).not.toEqual(before.homes[id]);
  }
  expectSameArticles(mounted); expectLayers(visibleDuringReturn);
  await advance(1000);
  expect(diagnostic()).toMatchObject({ moving: false, returningIds: [], visualPhase: "home", homes: before.homes });
  for (const node of flow.nodes) {
    expect(node.position).toEqual(before.homes[node.id]);
    expect(node.data.layer).toBe("home");
  }
  expectSameArticles(mounted);
});

it("holds PRESERVE without camera commands, then freezes a manual return at its interpolated position until Follow applies accepted refocus", async () => {
  await widen();
  const mounted = articles(), homes = diagnostic().homes, composed = diagnostic().positions;
  flow.setViewport.mockClear(); await next();
  expect(diagnostic().positions).toEqual(composed);
  expect(diagnostic().acceptedLatest).toBe(story.steps[8]!.label);
  expect(flow.setViewport).not.toHaveBeenCalled();
  await click("HOME"); await advance(80);
  expect(diagnostic().returningIds).toHaveLength(2);
  const geometrySnapshot = () => flow.nodes.map(node => ({ id: node.id, width: node.style.width,
    presentation: articles().get(node.id)!.dataset.presentation,
    origin: articles().get(node.id)!.querySelector(".choreo-origin")?.textContent ?? null,
    font: articles().get(node.id)!.style.getPropertyValue("--teaching-font") }));
  const sampledGeometry = geometrySnapshot();
  for (const id of diagnostic().returningIds) expect(sampledGeometry.find(item => item.id === id)).toMatchObject({ width: 280, presentation: "true" });
  await click("Simulate pan");
  const held = diagnostic();
  expect(geometrySnapshot()).toEqual(sampledGeometry);
  expect(held).toMatchObject({ mode: "TEACHER_INSPECTION", visualPhase: "paused", moving: true });
  flow.setViewport.mockClear();
  await next();
  expect(diagnostic()).toMatchObject({ positions: held.positions, camera: held.camera, returningIds: held.returningIds,
    visualPhase: "paused", visibleStep: held.visibleStep, acceptedLatest: story.steps[9]!.label });
  expect(geometrySnapshot()).toEqual(sampledGeometry);
  expect(flow.setViewport).not.toHaveBeenCalled(); expectSameArticles(mounted);
  const rate = flow.nodes.find(node => node.data.text.startsWith("For fixed A and temperature"))!;
  expect(rate.data.text).not.toContain("The exponential factor becomes larger.");
  await click("Inspect arrhenius");
  expect(flow.nodes.find(node => node.id === rate.id)!.data.text).toContain("The exponential factor becomes larger.");
  expect(diagnostic().positions).toEqual(held.positions);
  expect(geometrySnapshot()).toEqual(sampledGeometry);
  expect(diagnostic().measurements[rate.id]).toEqual({ width: 280, height: held.measurements[rate.id]!.height + 40 });
  const reviewCamera = diagnostic().camera;
  flow.setViewport.mockClear(); await next(); await next();
  expect(diagnostic()).toMatchObject({ positions: held.positions, camera: reviewCamera, acceptedLatest: story.steps[11]!.label });
  expect(geometrySnapshot()).toEqual(sampledGeometry);
  expect(flow.setViewport).not.toHaveBeenCalled();
  await click("Follow latest");
  expect(diagnostic()).toMatchObject({ mode: "AUTO_FOLLOW", visibleStep: story.steps[11]!.label });
  expect(flow.setViewport).toHaveBeenCalledOnce();
  const latest = teachingScene(story.steps[11]!);
  expect(flow.nodes.filter(node => node.data.role === "primary").map(node => node.id)).toEqual(latest.primary);
  await advance(1000);
  expect(diagnostic()).toMatchObject({ homes, returningIds: [], moving: false });
  for (const node of flow.nodes) expect(node.position).toEqual(homes[node.id]);
  expectSameArticles(mounted);
});

it("uses only the accepted new primary role during direct semantic refocus, including a return already in progress", async () => {
  await widen();
  const mounted = articles(), homes = diagnostic().homes;
  const previousPrimary = flow.nodes.find(node => node.data.role === "primary")!.id;
  await next(); await next(); await next(false); await advance(80); await next(false);
  const latest = teachingScene(story.steps[11]!);
  expect(diagnostic().visibleStep).toBe(latest.label);
  expect(diagnostic().returningIds).toHaveLength(2);
  expect(flow.nodes.filter(node => node.data.role === "primary").map(node => node.id)).toEqual(latest.primary);
  expect(flow.nodes.find(node => node.id === previousPrimary)!.data.role).toBe("history");
  expect(articles().get(previousPrimary)!.dataset.role).toBe("history");
  expectLayers(diagnostic().returningIds);
  expectSameArticles(mounted);
  await advance(1000);
  expect(diagnostic()).toMatchObject({ homes, moving: false, returningIds: [] });
  expectSameArticles(mounted);
});

it("waits for the pending latest composition when Follow is requested instead of replaying the previous frame", async () => {
  await widen(); await click("Simulate pan"); await next();
  const held = diagnostic();
  preparation.deferredLabel = story.steps[9]!.label;
  flow.setViewport.mockClear(); await next(false); await click("Follow latest");
  expect(preparation.release).toBeDefined();
  expect(diagnostic()).toMatchObject({ mode: "TEACHER_INSPECTION", visibleStep: held.visibleStep, positions: held.positions });
  expect(flow.setViewport).not.toHaveBeenCalled();
  await act(async () => preparation.release!());
  expect(diagnostic()).toMatchObject({ mode: "AUTO_FOLLOW", acceptedLatest: story.steps[9]!.label, visibleStep: story.steps[9]!.label });
  expect(flow.setViewport).toHaveBeenCalledOnce();
  expect(flow.nodes.some(node => node.data.text.includes("The exponential factor becomes larger."))).toBe(true);
  await advance(1000);
  expect(diagnostic().visualPhase).toBe("composed");
});

it("renders real COMPARE relations without arrow markers and ignores programmatic camera callbacks", async () => {
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="Scenario"]')!;
  await act(async () => { select.value = "trig-compare"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await advance(1000);
  const mounted = articles();
  await next(false);
  expect(diagnostic().framing).toBe("COMPARE");
  await advance(160);
  expect(flow.edges.every(edge => edge.style.opacity === 0)).toBe(true);
  await advance(1000);
  expect(flow.edges.length).toBeGreaterThan(0);
  for (const edge of flow.edges) {
    expect(edge.markerEnd).toBeUndefined(); expect(edge.style.opacity).toBe(1); expect(edge.data.path).not.toBe("");
  }
  expect(flow.nodes.filter(node => node.data.role === "primary" && node.data.kind !== "WORK")).toHaveLength(2);
  for (const [id, element] of mounted) expect(articles().get(id)).toBe(element);
  await click("Programmatic viewport event");
  expect(diagnostic().mode).toBe("AUTO_FOLLOW");
  flow.setViewport.mockClear(); await next(false);
  expect(diagnostic().returningIds.length).toBeGreaterThan(0);
  expect(flow.setViewport).toHaveBeenCalledOnce();
  await advance(1000);
  expect(diagnostic().visualPhase).toBe("home");
});
