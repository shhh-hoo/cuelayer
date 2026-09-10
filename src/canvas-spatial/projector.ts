import type { SharedProjectorIntent } from "../learner-projection/contracts.ts";
import type { AttentionFrame } from "./canvas-projection.ts";
import { bounds, type Rect, type Size, type Viewport } from "./geometry.ts";

export type ProjectorState = {
  mode: "AUTO_FOLLOW" | "TEACHER_INSPECTION";
  viewport: Viewport;
  latest?: AttentionFrame;
  lastTarget?: Viewport;
};
export type CameraCommand = { target: Viewport; duration: number };
export type ProjectorResult = { state: ProjectorState; command?: CameraCommand };
export const emptyProjector = (): ProjectorState => ({ mode: "AUTO_FOLLOW", viewport: { x: 40, y: 40, zoom: 1 } });
export const MIN_AUTO_ZOOM = 0.65;
export const MAX_AUTO_ZOOM = 1;
export const MIN_INSPECTION_ZOOM = 0.3;
const padding = (surface: Size) => surface.width < 600 ? 20 : 48;
const close = (a: Viewport, b: Viewport) => Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2 && Math.abs(a.zoom - b.zoom) < 0.005;

export function reframe(frame: AttentionFrame, surface: Size): Viewport | undefined {
  const all = bounds(frame.all);
  if (!all || surface.width <= 0 || surface.height <= 0) return undefined;
  const pad = padding(surface);
  const fit = Math.min((surface.width - 2 * pad) / all.width, (surface.height - 2 * pad) / all.height, MAX_AUTO_ZOOM);
  // Large selected neighborhoods remain inspectable; never shrink all lesson history
  // into unreadable miniatures. The primary composition wins when not everything fits.
  const target = fit < MIN_AUTO_ZOOM ? bounds(frame.primary) ?? all : all;
  const zoom = Math.max(MIN_AUTO_ZOOM, Math.min(MAX_AUTO_ZOOM, (surface.width - 2 * pad) / target.width, (surface.height - 2 * pad) / target.height));
  return { x: surface.width / 2 - (target.x + target.width / 2) * zoom,
    y: surface.height / 2 - (target.y + target.height / 2) * zoom, zoom };
}

function follow(viewport: Viewport, frame: AttentionFrame, surface: Size): Viewport | undefined {
  const target = bounds(frame.all);
  if (!target || surface.width <= 0 || surface.height <= 0) return undefined;
  const pad = padding(surface);
  if (target.width * viewport.zoom > surface.width - 2 * pad || target.height * viewport.zoom > surface.height - 2 * pad) return reframe(frame, surface);
  const correction = (start: number, length: number, limit: number) => start < pad ? pad - start : start + length > limit - pad ? limit - pad - start - length : 0;
  return { ...viewport,
    x: viewport.x + correction(target.x * viewport.zoom + viewport.x, target.width * viewport.zoom, surface.width),
    y: viewport.y + correction(target.y * viewport.zoom + viewport.y, target.height * viewport.zoom, surface.height) };
}

function commandFor(state: ProjectorState, target: Viewport | undefined, reducedMotion: boolean): ProjectorResult {
  if (!target || close(state.viewport, target) || (state.lastTarget && close(state.lastTarget, target))) return { state };
  return { state: { ...state, viewport: target, lastTarget: target }, command: { target, duration: reducedMotion ? 0 : 220 } };
}

/** Accepted projection updates always replace latest, including during inspection.
 * No semantic inputs or setters are held here; this controller cannot refocus a Core.
 */
export function updateProjector(previous: ProjectorState, frame: AttentionFrame, intent: SharedProjectorIntent, surface: Size, reducedMotion = false): ProjectorResult {
  const state = { ...previous, latest: frame };
  if (state.mode === "TEACHER_INSPECTION" || intent === "PRESERVE_VIEW") return { state };
  return commandFor(state, intent === "REFRAME_ATTENTION" ? reframe(frame, surface) : follow(state.viewport, frame, surface), reducedMotion);
}

export function inspectViewport(state: ProjectorState, viewport: Viewport): ProjectorState {
  return { ...state, mode: "TEACHER_INSPECTION", viewport: { ...viewport }, lastTarget: undefined };
}

export function followTeaching(previous: ProjectorState, surface: Size, reducedMotion = false): ProjectorResult {
  const state: ProjectorState = { ...previous, mode: "AUTO_FOLLOW", lastTarget: undefined };
  return commandFor(state, state.latest ? reframe(state.latest, surface) : undefined, reducedMotion);
}

export function inspectRegion(previous: ProjectorState, rects: Rect[], surface: Size, reducedMotion = false): ProjectorResult {
  const region = bounds(rects);
  let target: Viewport | undefined;
  if (region && surface.width > 0 && surface.height > 0) {
    // Explicit inspection uses the existing manual zoom range, so restored Support
    // can fit on narrow screens without lowering the automatic teaching zoom floor.
    const pad = padding(surface);
    const zoom = Math.max(MIN_INSPECTION_ZOOM, Math.min(MAX_AUTO_ZOOM,
      (surface.width - 2 * pad) / region.width, (surface.height - 2 * pad) / region.height));
    target = { x: surface.width / 2 - (region.x + region.width / 2) * zoom,
      y: surface.height / 2 - (region.y + region.height / 2) * zoom, zoom };
  }
  return commandFor({ ...previous, mode: "TEACHER_INSPECTION", lastTarget: undefined }, target, reducedMotion);
}
