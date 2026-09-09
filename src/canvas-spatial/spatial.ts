import { graphlib, layout } from "@dagrejs/dagre";
import type { CoreTeachingState, SemanticReference } from "../lesson-stream/core/contracts.ts";
import type { LearnerProjection } from "../learner-projection/contracts.ts";
import { bounds, freePosition, type Point, type Rect, type Size } from "./geometry.ts";

export type SpatialElement = { key: string; coreId?: string; kind: "CORE" | "OBJECT" | "SUPPORT" | "REPRESENTATION" | "WORK" | "CUE";
  position: Point; size: Size; measured?: Size; anchorKey?: string };
export type SpatialState = { sessionId: string; coreOrigins: Record<string, Point>; elements: Record<string, SpatialElement> };
export const emptySpatial = (sessionId: string): SpatialState => ({ sessionId, coreOrigins: {}, elements: {} });
// JSON tuples avoid delimiter collisions; lesson identities never depend on text or renderer order.
export const semanticKey = (sessionId: string, ref: SemanticReference) => JSON.stringify([sessionId, ref.kind, "coreId" in ref ? ref.coreId : null, ref.id]);
export const transientKey = (sessionId: string, kind: "REPRESENTATION" | "WORK", id: string) => JSON.stringify([sessionId, kind, id]);
export const rendererId = (key: string) => `m4b:${encodeURIComponent(key)}`;
export const rectOf = (element: SpatialElement): Rect => ({ ...element.position, ...(element.measured ?? element.size) });
export const objectRef = (coreId: string, id: string): SemanticReference => ({ kind: "OBJECT", coreId, id });
export const coreRef = (id: string): SemanticReference => ({ kind: "CORE", id });
export const textSize = (text: string): Size => ({ width: 256, height: Math.max(112, Math.min(300, 48 + Math.ceil(text.length / 28) * 22)) });

/** A single representation of an object replaces its rendering at the same anchor.
 * PAIR/COMPARE siblings stay transient; none becomes another semantic object.
 */
export function inlineRepresentations(projection: LearnerProjection) {
  return projection.attention.representations.filter(r => r.target?.kind === "OBJECT"
    && projection.attention.representations.filter(other => other.target && semanticKey("", other.target) === semanticKey("", r.target!)).length === 1);
}

export function referenceKeys(state: CoreTeachingState, ref: SemanticReference): string[] {
  if (ref.kind === "RELATION") {
    const relation = state.knowledge.cores[ref.coreId]?.relations[ref.id];
    return relation?.status === "valid" ? [relation.value.fromObjectId, relation.value.toObjectId]
      .map(id => semanticKey(state.sessionId, objectRef(ref.coreId, id))) : [];
  }
  return [semanticKey(state.sessionId, ref)];
}

export function advanceSpatial(previous: SpatialState, state: CoreTeachingState, projection: LearnerProjection): SpatialState {
  const old = previous.sessionId === state.sessionId ? previous : emptySpatial(state.sessionId);
  const next: SpatialState = { sessionId: state.sessionId, coreOrigins: { ...old.coreOrigins }, elements: { ...old.elements } };
  const inline = new Set(inlineRepresentations(projection).map(r => r.id));
  const transient = new Set([
    ...projection.attention.representations.filter(r => !inline.has(r.id)).map(r => transientKey(state.sessionId, "REPRESENTATION", r.id)),
    ...(projection.workSurface?.blocks ?? []).map(b => transientKey(state.sessionId, "WORK", b.id)),
  ]);
  for (const [key, element] of Object.entries(next.elements)) {
    if ((element.kind === "WORK" || element.kind === "REPRESENTATION") && !transient.has(key)) delete next.elements[key];
    if (element.kind === "CUE" && key !== (projection.attention.cue ? semanticKey(state.sessionId, { kind: "CUE", id: projection.attention.cue.cueId }) : undefined)) delete next.elements[key];
  }
  const occupied = () => Object.values(next.elements).map(rectOf);
  const place = (key: string, kind: SpatialElement["kind"], size: Size, preferred: Point, coreId?: string, anchorKey?: string) => {
    if (next.elements[key]) return;
    next.elements[key] = { key, kind, coreId, position: freePosition(size, preferred, occupied()), size, anchorKey };
  };
  // Stable sort is only a deterministic tie-break for new identities, never an identity source.
  for (const core of Object.values(state.knowledge.cores).sort((a, b) => a.id.localeCompare(b.id))) {
    const coreKey = semanticKey(state.sessionId, coreRef(core.id));
    if (!next.coreOrigins[core.id]) {
      const extent = bounds(occupied());
      const origin = freePosition({ width: 256, height: 44 }, { x: extent ? extent.x + extent.width + 160 : 0, y: 0 }, occupied(), 80);
      next.coreOrigins[core.id] = origin;
      next.elements[coreKey] = { key: coreKey, coreId: core.id, kind: "CORE", position: origin, size: { width: 256, height: 44 } };
    }
    const added = Object.values(core.objects).filter(o => o.status === "valid" && !next.elements[semanticKey(state.sessionId, objectRef(core.id, o.id))]).sort((a, b) => a.id.localeCompare(b.id));
    if (!added.length) continue;
    const addedIds = new Set(added.map(o => o.id));
    const relations = Object.values(core.relations).filter(r => r.status === "valid").sort((a, b) => a.id.localeCompare(b.id));
    const connection = relations.find(r => addedIds.has(r.value.toObjectId) && !addedIds.has(r.value.fromObjectId));
    const anchor = connection ? next.elements[semanticKey(state.sessionId, objectRef(core.id, connection.value.fromObjectId))] : undefined;
    const graph = new graphlib.Graph().setGraph({ rankdir: "TB", nodesep: 32, ranksep: 52 }).setDefaultEdgeLabel(() => ({}));
    for (const object of added) graph.setNode(object.id, { ...textSize(object.value.text) });
    for (const relation of relations) if (addedIds.has(relation.value.fromObjectId) && addedIds.has(relation.value.toObjectId)) graph.setEdge(relation.value.fromObjectId, relation.value.toObjectId);
    layout(graph); // ONLY the genuinely new mini-subgraph; labels are fresh copies.
    // Disconnected additions use a vertical local lane, avoiding Dagre's wide row on narrow projectors.
    const disconnected = graph.edgeCount() === 0;
    let laneY = 0;
    const suggestions = added.map(object => {
      const size = textSize(object.value.text);
      const node = graph.node(object.id);
      const rect = { id: object.id, ...size, x: disconnected ? 0 : node.x - size.width / 2, y: disconnected ? laneY : node.y - size.height / 2 };
      laneY += size.height + 32;
      return rect;
    });
    const group = bounds(suggestions)!;
    const origin = next.coreOrigins[core.id]!;
    const preferred = anchor ? { x: anchor.position.x, y: rectOf(anchor).y + rectOf(anchor).height + 52 } : { x: origin.x, y: origin.y + 80 };
    const location = freePosition(group, preferred, occupied());
    for (const suggested of suggestions) {
      const key = semanticKey(state.sessionId, objectRef(core.id, suggested.id));
      next.elements[key] = { key, kind: "OBJECT", coreId: core.id, position: { x: location.x + suggested.x - group.x, y: location.y + suggested.y - group.y }, size: { width: suggested.width, height: suggested.height }, anchorKey: anchor?.key ?? coreKey };
    }
  }
  const anchorFor = (refs: SemanticReference[]) => refs.flatMap(ref => referenceKeys(state, ref)).map(key => next.elements[key]).find(Boolean)
    ?? next.elements[semanticKey(state.sessionId, coreRef(state.knowledge.currentCoreId ?? ""))];
  const beside = (anchor?: SpatialElement): Point => anchor ? { x: anchor.position.x, y: rectOf(anchor).y + rectOf(anchor).height + 32 } : { x: 0, y: 0 };
  for (const ref of projection.attention.support) {
    if (ref.kind !== "SUPPORT") continue;
    const support = state.knowledge.cores[ref.coreId]?.supports[ref.id];
    if (!support || support.status !== "valid") continue;
    const anchor = anchorFor([support.value.target]);
    place(semanticKey(state.sessionId, ref), "SUPPORT", textSize(support.value.text), beside(anchor), ref.coreId, anchor?.key);
  }
  const newRepresentations = projection.attention.representations.filter(rep => !inline.has(rep.id)
    && !next.elements[transientKey(state.sessionId, "REPRESENTATION", rep.id)]);
  // Keep newly co-primary source slots together. Sequential nearest-point choices
  // can scatter the second source into another lane and clip a narrow comparison.
  if (projection.transition.framing === "COMPARE" && newRepresentations.length > 1) {
    const first = newRepresentations[0]!;
    const anchor = anchorFor(first.target ? [first.target] : []);
    const position = freePosition({ width: 256, height: newRepresentations.length * 160 - 32 }, beside(anchor), occupied());
    newRepresentations.forEach((rep, index) => {
      const key = transientKey(state.sessionId, "REPRESENTATION", rep.id);
      next.elements[key] = { key, kind: "REPRESENTATION", coreId: anchor?.coreId, anchorKey: anchor?.key,
        position: { x: position.x, y: position.y + index * 160 }, size: { width: 256, height: 128 } };
    });
  }
  for (const rep of projection.attention.representations) {
    if (inline.has(rep.id)) continue;
    const anchor = anchorFor(rep.target ? [rep.target] : []);
    place(transientKey(state.sessionId, "REPRESENTATION", rep.id), "REPRESENTATION", { width: 256, height: 128 }, beside(anchor), anchor?.coreId, anchor?.key);
  }
  for (const block of projection.workSurface?.blocks ?? []) {
    const anchor = anchorFor(block.semanticRefs);
    place(transientKey(state.sessionId, "WORK", block.id), "WORK", { width: 256, height: 144 }, beside(anchor), anchor?.coreId, anchor?.key);
  }
  if (projection.attention.cue && state.cue.active?.id === projection.attention.cue.cueId) {
    const cue = state.cue.active;
    const anchor = anchorFor(cue.target ? [cue.target] : []);
    place(semanticKey(state.sessionId, { kind: "CUE", id: cue.id }), "CUE", textSize(cue.text), beside(anchor), anchor?.coreId, anchor?.key);
  }
  return next;
}

/** Measurement feedback records geometry, never invokes layout or moves a node.
 * The renderer reserves these dimensions and scrolls unusually long revisions locally.
 */
export function measureSpatial(spatial: SpatialState, key: string, size: Size): SpatialState {
  const element = spatial.elements[key];
  if (!element || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) return spatial;
  const old = element.measured ?? element.size;
  if (Math.abs(old.width - size.width) < 0.5 && Math.abs(old.height - size.height) < 0.5) return spatial;
  return { ...spatial, elements: { ...spatial.elements, [key]: { ...element, measured: { ...size } } } };
}
