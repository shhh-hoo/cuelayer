// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Viewport } from "../../canvas-spatial/geometry.ts";
import M4BCanvas from "./M4BCanvas";

const flow = vi.hoisted(() => ({ viewport: { x: 0, y: 0, zoom: 1 }, setViewport: vi.fn(), getViewport: vi.fn() }));
vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  Background: () => null, Handle: () => null, Position: { Top: "top", Bottom: "bottom" },
  useReactFlow: () => ({ setViewport: flow.setViewport, getViewport: flow.getViewport }),
  ReactFlow: ({ children, onMoveStart, onMove, onMoveEnd }: {
    children: ReactNode; onMoveStart: (event: unknown) => void;
    onMove: (event: unknown, viewport: Viewport) => void; onMoveEnd: (event: unknown, viewport: Viewport) => void;
  }) => <div>{children}{["pan", "zoom"].map(gesture => <button key={gesture} onClick={() => {
    const event = new MouseEvent("pointerdown"); onMoveStart(event);
    const next = { ...flow.viewport, x: flow.viewport.x + 200, zoom: gesture === "zoom" ? 0.8 : flow.viewport.zoom };
    flow.viewport = next; onMove(event, next); onMoveEnd(event, next);
  }}>Simulate {gesture}</button>)}<button onClick={() => { onMoveStart(null); onMove(null, flow.viewport); onMoveEnd(null, flow.viewport); }}>Programmatic viewport event</button></div>,
}));

let root: Root, container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width: 1280, height: 520 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    disconnect() {}
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  flow.viewport = { x: 40, y: 40, zoom: 1 };
  flow.setViewport.mockReset().mockImplementation((viewport: Viewport) => { flow.viewport = viewport; return Promise.resolve(true); });
  flow.getViewport.mockReset().mockImplementation(() => flow.viewport);
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => { root.render(<M4BCanvas />); });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const review = () => container.querySelector<HTMLElement>(".m4b-review")!;
const click = async (name: string) => {
  const button = [...container.querySelectorAll("button")].find(b => b.textContent === name)!;
  expect(button, name).toBeDefined(); expect(button.disabled).toBe(false);
  await act(async () => button.click());
};
async function select(id: string) {
  const select = container.querySelector("select")!;
  await act(async () => { select.value = id; select.dispatchEvent(new Event("change", { bubbles: true })); });
}

it.each(["pan", "zoom"])("wires manual %s into inspection and holds across incoming updates", async gesture => {
  await select("shared-inspection");
  for (let i = 0; i < 3; i++) await click("Next");
  expect(review().dataset.currentCore).toBe("arrhenius");
  await click(`Simulate ${gesture}`);
  expect(review().dataset.mode).toBe("TEACHER_INSPECTION");
  const viewport = review().dataset.viewport;
  flow.setViewport.mockClear();
  await click("Next");
  expect(review().dataset.currentCore).toBe("arrhenius");
  expect(review().dataset.viewport).toBe(viewport);
  expect(review().dataset.step).toBe("4");
  expect(flow.setViewport).not.toHaveBeenCalled();
  await click("Follow teaching →");
  expect(review().dataset.mode).toBe("AUTO_FOLLOW");
  expect(review().dataset.viewport).not.toBe(viewport);
  expect(flow.setViewport).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
});
it("keeps explicit inspection through a true accepted refocus until Follow teaching", async () => {
  await select("shared-inspection");
  for (let i = 0; i < 3; i++) await click("Next");
  await click("Inspect catalysts");
  expect(review().dataset.currentCore).toBe("arrhenius");
  expect(review().dataset.mode).toBe("TEACHER_INSPECTION");
  const viewport = review().dataset.viewport;
  flow.setViewport.mockClear();
  await click("Next"); await click("Next");
  expect(review().dataset.currentCore).toBe("catalysts");
  expect(review().dataset.mode).toBe("TEACHER_INSPECTION");
  expect(review().dataset.viewport).toBe(viewport);
  expect(flow.setViewport).not.toHaveBeenCalled();
  await click("Follow teaching →");
  expect(review().dataset.mode).toBe("AUTO_FOLLOW");
});
it("does not treat programmatic camera callbacks as teacher inspection", async () => {
  await click("Programmatic viewport event");
  expect(review().dataset.mode).toBe("AUTO_FOLLOW");
});
it("does not issue camera commands for successive tangent steps", async () => {
  await select("tangent");
  flow.setViewport.mockClear();
  const count = review().dataset.cameraCommands;
  await click("Next"); await click("Next");
  expect(review().dataset.cameraCommands).toBe(count);
  expect(flow.setViewport).not.toHaveBeenCalled();
});
it("Reset restores initial spatial playback and auto-follow after inspection", async () => {
  await click("Next"); await click("Simulate pan"); await click("Reset");
  expect(review().dataset.step).toBe("0");
  expect(review().dataset.mode).toBe("AUTO_FOLLOW");
});
it("uses immediate camera commands when reduced motion is selected", async () => {
  const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => checkbox.click());
  await click("Simulate pan"); flow.setViewport.mockClear(); await click("Follow teaching →");
  expect(flow.setViewport.mock.calls[0]![1]).toEqual({ duration: 0, interpolate: "linear" });
  expect(review().dataset.reducedMotion).toBe("true");
});
