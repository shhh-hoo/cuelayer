import { projectCanvas } from "../../canvas-spatial/canvas-projection.ts";
import { coreRef, inlineRepresentations, objectRef, referenceKeys, rendererId, semanticKey, transientKey,
  type SpatialElement, type SpatialState } from "../../canvas-spatial/spatial.ts";
import type { SemanticReference } from "../../lesson-stream/core/contracts.ts";
import { bounds, overlaps, type Point, type Size } from "../../canvas-spatial/geometry.ts";
import type { ChoreographyStep } from "./scenarios.ts";
import type { SolveResult } from "./solvers.ts";

export type TeachingItem = { id: string; coreId?: string; text: string; kind: string;
  role: "primary" | "context" | "history"; label: string; durable: boolean; visible: boolean };
export type TeachingEdge = { id: string; source: string; target: string; label: string };
export type TeachingScene = { items: TeachingItem[]; edges: TeachingEdge[]; primary: string[]; required: string[];
  framing: "HOME" | "FOCUS" | "COMPARE" | "WIDEN"; preserve: boolean; currentCoreId?: string; label: string };
export type Measurements = Record<string, Size>;
export type HomeGeometry = { positions: Record<string, Point>; sizes: Measurements; coreOrigins: Record<string, Point> };
export const emptyHomes = (): HomeGeometry => ({ positions: {}, sizes: {}, coreOrigins: {} });

/** A geometry-free adapter for the existing metadata projection. Zero positions
 * and 1×1 boxes only satisfy its input shape; they never become home or measured
 * geometry. No Dagre pass, collision search or whole-world layout runs here.
 */
function rendererCatalog({ state, projection }: ChoreographyStep): SpatialState {
  const spatial: SpatialState = { sessionId: state.sessionId, coreOrigins: {}, elements: {} };
  const add = (key: string, kind: SpatialElement["kind"], coreId?: string, anchor?: SpatialElement) => {
    spatial.elements[key] = { key, kind, coreId, anchorKey: anchor?.key, position: { x: 0, y: 0 }, size: { width: 1, height: 1 } };
  };
  for (const core of Object.values(state.knowledge.cores)) {
    spatial.coreOrigins[core.id] = { x: 0, y: 0 };
    add(semanticKey(state.sessionId, coreRef(core.id)), "CORE", core.id);
    for (const object of Object.values(core.objects)) if (object.status === "valid") {
      add(semanticKey(state.sessionId, objectRef(core.id, object.id)), "OBJECT", core.id);
    }
  }
  const anchorFor = (refs: SemanticReference[]) => refs.flatMap(ref => referenceKeys(state, ref))
    .map(key => spatial.elements[key]).find(Boolean)
    ?? spatial.elements[semanticKey(state.sessionId, coreRef(state.knowledge.currentCoreId ?? ""))];
  for (const ref of projection.attention.support) {
    if (ref.kind !== "SUPPORT") continue;
    const support = state.knowledge.cores[ref.coreId]?.supports[ref.id];
    if (support?.status === "valid") add(semanticKey(state.sessionId, ref), "SUPPORT", ref.coreId, anchorFor([support.value.target]));
  }
  const inline = new Set(inlineRepresentations(projection).map(rep => rep.id));
  const representations = projection.attention.representations.filter(rep => !inline.has(rep.id));
  // Preserve the existing renderer's parent metadata for co-primary sibling
  // surfaces; this does not introduce a semantic grouping or layout constraint.
  const first = representations[0];
  const siblings = projection.transition.framing === "COMPARE" && representations.length > 1;
  const siblingAnchor = siblings ? anchorFor(first?.target ? [first.target] : []) : undefined;
  for (const rep of representations) {
    const anchor = siblings ? siblingAnchor : anchorFor(rep.target ? [rep.target] : []);
    add(transientKey(state.sessionId, "REPRESENTATION", rep.id), "REPRESENTATION", anchor?.coreId, anchor);
  }
  for (const block of projection.workSurface?.blocks ?? []) {
    const anchor = anchorFor(block.semanticRefs);
    add(transientKey(state.sessionId, "WORK", block.id), "WORK", anchor?.coreId, anchor);
  }
  if (projection.attention.cue && state.cue.active?.id === projection.attention.cue.cueId) {
    const cue = state.cue.active;
    const anchor = anchorFor(cue.target ? [cue.target] : []);
    add(semanticKey(state.sessionId, { kind: "CUE", id: cue.id }), "CUE", anchor?.coreId, anchor);
  }
  return spatial;
}

/** Existing projection owns identity, validity and attention. Only its catalog
 * metadata is consumed; presentation solvers receive selected measured boxes.
 */
export function teachingScene(step: ChoreographyStep, inspectedCoreId?: string): TeachingScene {
  const spatial = rendererCatalog(step);
  const render = projectCanvas(step.state, step.projection, spatial, inspectedCoreId);
  // Retained Support omitted from today's projection still gets a home. It does
  // not enter the live visible/required sets merely because it exists.
  const items: TeachingItem[] = render.nodes.map(node => ({ id: node.id, coreId: node.data.coreId,
    text: node.data.text, kind: node.data.kind, role: node.data.role, label: node.data.label,
    durable: ["CORE", "OBJECT", "SUPPORT"].includes(node.data.kind), visible: true }));
  for (const core of Object.values(step.state.knowledge.cores)) {
    for (const support of Object.values(core.supports)) {
      if (support.status !== "valid") continue;
      const id = rendererId(semanticKey(step.state.sessionId, { kind: "SUPPORT", coreId: core.id, id: support.id }));
      if (!items.some(item => item.id === id)) items.push({ id, coreId: core.id, text: support.value.text,
        kind: "SUPPORT", role: "history", label: "Support", durable: true, visible: inspectedCoreId === core.id });
    }
  }
  // Projection-only source intents have identity but no source payload. Keep that
  // limitation explicit instead of fabricating quotations or measuring fake art.
  for (const item of items) {
    const node = render.nodes.find(n => n.id === item.id)!;
    if (node?.data.kind === "REPRESENTATION") item.text = `${node.data.label.replaceAll("_", " ")}: source payload not supplied by this fixture.`;
    if (node?.data.kind === "WORK") item.text = node.data.text;
  }
  const primary = items.filter(item => item.visible && item.role === "primary").map(item => item.id);
  const framing = step.home ? "HOME" : step.projection.transition.framing;
  const required = framing === "WIDEN" || framing === "COMPARE"
    ? items.filter(item => item.visible && (item.role === "primary" || item.role === "context") && item.kind !== "WORK").map(item => item.id)
    : framing === "HOME" ? items.filter(item => item.visible && item.coreId === step.state.knowledge.currentCoreId && item.durable).map(item => item.id)
      : primary;
  return { items, edges: render.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.ariaLabel ?? "" })),
    primary, required, framing, preserve: step.projection.projector === "PRESERVE_VIEW", currentCoreId: step.state.knowledge.currentCoreId, label: step.label };
}

/** Spike-only append placement for home memory, not a proposed product allocator.
 * Established home positions never change. Intrinsic dimensions may change with
 * revised text; that can expose home overlap, which is deliberately not repaired
 * by moving established knowledge. Temporary solvers operate separately.
 */
export function acceptHomes(previous: HomeGeometry, scene: TeachingScene, measured: Measurements): HomeGeometry {
  const next: HomeGeometry = { positions: { ...previous.positions }, sizes: { ...previous.sizes }, coreOrigins: { ...previous.coreOrigins } };
  for (const item of scene.items) {
    if (!item.durable || !measured[item.id]) continue;
    const core = item.coreId ?? "lesson";
    if (!next.coreOrigins[core]) {
      const extent = bounds(Object.entries(next.positions).map(([id, point]) => ({ ...point, ...next.sizes[id]! })));
      next.coreOrigins[core] = { x: extent ? extent.x + extent.width + 240 : 0, y: 0 };
    }
    const origin = next.coreOrigins[core]!;
    if (!next.positions[item.id]) {
      const priorItems = scene.items.filter(other => other.coreId === item.coreId && next.positions[other.id]);
      const bottom = Math.max(origin.y, ...priorItems.map(other => next.positions[other.id]!.y + next.sizes[other.id]!.height + 48));
      next.positions[item.id] = { x: origin.x, y: bottom };
    }
    next.sizes[item.id] = { ...measured[item.id]! };
  }
  return next;
}

export function temporaryPlacement(result: SolveResult, selected: TeachingItem[], sizes: Measurements, homes: HomeGeometry, scene: TeachingScene): Record<string, Point> {
  const first = selected.find(item => item.role === "primary") ?? selected[0];
  if (!first) return {};
  const seed = homes.positions[first.id] ?? homes.coreOrigins[first.coreId ?? ""] ?? { x: 0, y: 0 };
  const local = result.positions[first.id]!;
  const translate = (offset: Point) => Object.fromEntries(selected.map(item => [item.id,
    { x: result.positions[item.id]!.x + offset.x, y: result.positions[item.id]!.y + offset.y }]));
  let positions = translate({ x: seed.x - local.x, y: seed.y - local.y });
  const selectedIds = new Set(selected.map(item => item.id));
  const obstacles = scene.items.filter(item => item.visible && item.durable && !selectedIds.has(item.id) && homes.positions[item.id])
    .map(item => ({ ...homes.positions[item.id]!, ...homes.sizes[item.id]! }));
  if (selected.some(item => obstacles.some(rect => overlaps({ ...positions[item.id]!, ...sizes[item.id]! }, rect, 24)))) {
    // One vacant temporary region above home geography, rather than a growing
    // collision-search allocator or global layout of unrelated knowledge.
    const area = bounds(selected.map(item => ({ ...result.positions[item.id]!, ...sizes[item.id]! })))!;
    const top = Math.min(0, ...Object.values(homes.positions).map(point => point.y));
    positions = translate({ x: seed.x - local.x, y: top - area.height - 96 - area.y });
  }
  return positions;
}

export type TeachingFrame = { scene: TeachingScene; positions: Record<string, Point>; sizes: Measurements; solveMs: number; notes: string[];
  compact?: boolean; inspectedCoreId?: string };
export type ChoreographyState = { mode: "AUTO_FOLLOW" | "TEACHER_INSPECTION"; visible?: TeachingFrame; latest?: TeachingFrame };
export const emptyChoreography = (): ChoreographyState => ({ mode: "AUTO_FOLLOW" });
const validFrame = (frame: TeachingFrame, latest: TeachingFrame): TeachingFrame => {
  const valid = new Set(latest.scene.items.map(item => item.id));
  const validEdges = new Set(latest.scene.edges.map(edge => edge.id));
  return { ...frame, scene: { ...frame.scene, items: frame.scene.items.filter(item => valid.has(item.id)),
    edges: frame.scene.edges.filter(edge => validEdges.has(edge.id) && valid.has(edge.source) && valid.has(edge.target)),
    primary: frame.scene.primary.filter(id => valid.has(id)), required: frame.scene.required.filter(id => valid.has(id)) },
    positions: Object.fromEntries(Object.entries(frame.positions).filter(([id]) => valid.has(id))),
    sizes: Object.fromEntries(Object.entries(frame.sizes).filter(([id]) => valid.has(id))) };
};

/** PRESERVE_VIEW holds the previously displayed composition and content snapshot;
 * new accepted input remains in latest. No explicit composition-replacement flag
 * exists in M4A, so this prototype never infers one while PRESERVE_VIEW is set.
 * Invalidated/removed objects are pruned immediately. Follow explicitly applies
 * latest even when its original projector intent was PRESERVE_VIEW.
 */
export function acceptFrame(state: ChoreographyState, latest: TeachingFrame): ChoreographyState {
  const hold = state.visible && (state.mode === "TEACHER_INSPECTION" || latest.scene.preserve);
  return { ...state, latest, visible: hold ? validFrame(state.visible!, latest) : latest };
}
export const inspectFrame = (state: ChoreographyState): ChoreographyState => ({ ...state, mode: "TEACHER_INSPECTION" });

/** An explicit Core review may reveal accepted knowledge that arrived while the
 * teacher held an older view. Existing rendered positions stay frozen; newly
 * revealed durable objects have no presentation position and therefore use the
 * renderer's unchanged accepted homes. Latest teaching remains separate.
 *
 * Held typography stays fixed. If latest was measured at another viewport, the
 * caller must remeasure changed/new review content using this frame's compact
 * setting; borrowing its newer measurements cannot establish readable fit.
 */
export function inspectCoreFrame(state: ChoreographyState, coreId: string): ChoreographyState {
  const latest = state.latest;
  const previous = state.visible ?? latest;
  if (!latest || !previous) return inspectFrame(state);
  const visible = validFrame(previous, latest);
  const oldItems = new Map(visible.scene.items.map(item => [item.id, item]));
  const review = latest.scene.items.filter(item => item.coreId === coreId && item.durable);
  if (!review.length) return { ...state, mode: "TEACHER_INSPECTION", visible };
  const replacements = new Map(review.map(item => [item.id, { ...item, visible: true,
    // Explicit inspection supplies visual context, not new teaching authority.
    // Already visible emphasis remains held; latest roles resume on Follow.
    role: oldItems.get(item.id)?.role ?? "context" as const }]));
  const items = visible.scene.items.map(item => replacements.get(item.id) ?? item);
  for (const item of replacements.values()) if (!oldItems.has(item.id)) items.push(item);
  const sizes = { ...visible.sizes };
  for (const item of review) {
    if (!sizes[item.id] || oldItems.get(item.id)?.text !== item.text) sizes[item.id] = { ...latest.sizes[item.id]! };
  }
  const reviewIds = new Set(review.map(item => item.id));
  const edges = new Map(visible.scene.edges.map(edge => [edge.id, edge]));
  for (const edge of latest.scene.edges) if (reviewIds.has(edge.source) && reviewIds.has(edge.target)) edges.set(edge.id, edge);
  return { ...state, mode: "TEACHER_INSPECTION", visible: { ...visible, inspectedCoreId: coreId, sizes,
    scene: { ...visible.scene, items, edges: [...edges.values()] } } };
}

export const resumeFrame = (state: ChoreographyState): ChoreographyState => ({ ...state, mode: "AUTO_FOLLOW", visible: state.latest });
