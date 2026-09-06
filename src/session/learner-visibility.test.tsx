// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TeachingSurfaceLayer } from "./TeachingSurfaceLayer";
import { createInitialTeachingState } from "../lesson-stream/teaching-state";
import { surfaceItems, surfaceVisibility } from "../trace/dom-visibility";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });
it("observes real React DOM after frames, never reports effect/CLI time as visible", async () => {
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const frames: FrameRequestCallback[] = []; vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.push(fn); return frames.length; }); vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, bottom: 20, right: 100, width: 100, height: 20, toJSON() {} });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => container.querySelector("[data-board-item-id]") });
  const state = createInitialTeachingState(); state.board.revision = 1; state.board.active = { id: "synthetic-board", establishedAtRevision: 1, sourceCheckpointIds: [], contribution: { mode: "REPRESENT", content: { kind: "TEXT", text: "Synthetic classification" }, provenance: { basis: "SPEECH" } } };
  const observed = vi.fn(); await act(async () => root.render(<TeachingSurfaceLayer state={state} presentationMode="presentationless" onVisibility={observed} />));
  expect(observed).not.toHaveBeenCalled(); expect(container.textContent).toContain("Synthetic classification");
  frames.shift()!(0); expect(observed).not.toHaveBeenCalled(); frames.shift()!(1);
  expect(observed).toHaveBeenCalledWith(expect.objectContaining({ boardRevision: 1, observation: "visible", domVisibleAt: expect.any(Number), rendererCommittedAt: expect.any(Number) }));
  await act(async () => root.unmount());
});
it("distinguishes each item and rejects hidden ancestors and out-of-viewport DOM", () => {
  document.body.innerHTML = '<section id="surface"><p data-board-item-id="x">Synthetic</p></section>';
  const root = document.querySelector<HTMLElement>("section")!; const p = root.querySelector<HTMLElement>("p")!;
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(p, "getBoundingClientRect").mockReturnValue({ top: 0, left: 0, bottom: 20, right: 100, width: 100, height: 20 } as DOMRect);
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => document.body });
  expect(surfaceVisibility(root)).toBe("visible");
  const support = document.createElement("p"); support.dataset.supportId = "support"; support.style.display = "none"; root.append(support);
  expect(surfaceItems(root)).toEqual([{ id: "x", observation: "visible" }, { id: "support", observation: "hidden" }]); root.style.display = "none"; expect(surfaceVisibility(root)).toBe("hidden");
  root.style.display = ""; vi.mocked(p.getBoundingClientRect).mockReturnValue({ top: -100, left: 0, bottom: -20, right: 100, width: 100, height: 80 } as DOMRect); expect(surfaceVisibility(root)).toBe("not_in_viewport");
});
