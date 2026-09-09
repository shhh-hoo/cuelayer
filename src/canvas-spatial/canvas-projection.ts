import type { Edge, Node } from "@xyflow/react";
import type { CoreTeachingState, SemanticReference } from "../lesson-stream/core/contracts.ts";
import type { LearnerProjection } from "../learner-projection/contracts.ts";
import { coreRef, inlineRepresentations, objectRef, rectOf, referenceKeys, rendererId, semanticKey, transientKey, type SpatialState } from "./spatial.ts";
import type { Rect } from "./geometry.ts";

export type CanvasData = { spatialKey: string; coreId?: string; text: string; label: string; kind: string;
  role: "primary" | "context" | "history"; parked: boolean; inspected: boolean; representationId?: string; workId?: string };
export type CanvasNode = Node<CanvasData, "teaching">;
export type AttentionFrame = { all: Rect[]; primary: Rect[]; framing: LearnerProjection["transition"]["framing"] };

/** Resolve only M4A-selected references. A CORE reference denotes its origin label,
 * not permission to fit every object/history item. Relations contribute their endpoints.
 */
export function attentionFrame(state: CoreTeachingState, projection: LearnerProjection, spatial: SpatialState): AttentionFrame {
  const attention = projection.attention;
  const refs = (values: SemanticReference[]) => values.flatMap(ref => referenceKeys(state, ref));
  const primary = refs([...(attention.anchor ? [attention.anchor] : []), ...attention.emphasis]);
  const all = [...primary, ...refs([...attention.context, ...attention.support])];
  const inline = new Set(inlineRepresentations(projection).map(r => r.id));
  for (const rep of attention.representations) {
    const keys = inline.has(rep.id) && rep.target ? referenceKeys(state, rep.target) : [transientKey(state.sessionId, "REPRESENTATION", rep.id)];
    all.push(...keys);
    if (rep.role === "dominant") primary.push(...keys);
  }
  for (const block of projection.workSurface?.blocks ?? []) all.push(transientKey(state.sessionId, "WORK", block.id));
  if (attention.cue) {
    const key = semanticKey(state.sessionId, { kind: "CUE", id: attention.cue.cueId });
    all.push(key);
    if (attention.cue.role === "dominant") primary.push(key);
  }
  const rectangles = (keys: string[]) => [...new Set(keys)].flatMap(key => spatial.elements[key] ? [rectOf(spatial.elements[key]!)] : []);
  return { all: rectangles(all), primary: rectangles(primary), framing: projection.transition.framing };
}

export function projectCanvas(state: CoreTeachingState, projection: LearnerProjection, spatial: SpatialState, inspectedCoreId?: string) {
  const nodes: CanvasNode[] = [];
  const edges: Edge[] = [];
  const selected = new Set([
    ...(projection.attention.anchor ? [projection.attention.anchor] : []), ...projection.attention.emphasis,
  ].flatMap(ref => referenceKeys(state, ref)));
  const context = new Set([...projection.attention.context, ...projection.attention.support].flatMap(ref => referenceKeys(state, ref)));
  const inline = inlineRepresentations(projection);
  const add = (key: string, text: string, label: string, extra: Partial<CanvasData> = {}) => {
    const element = spatial.elements[key];
    if (!element) return;
    const size = element.measured ?? element.size;
    nodes.push({ id: rendererId(key), type: "teaching", position: { ...element.position },
      data: { spatialKey: key, coreId: element.coreId, text, label, kind: element.kind,
        role: selected.has(key) ? "primary" : context.has(key) ? "context" : "history",
        parked: Boolean(element.coreId && element.coreId !== state.knowledge.currentCoreId),
        inspected: element.coreId === inspectedCoreId, ...extra },
      measured: { ...size }, style: { ...size }, draggable: false, selectable: false,
      ariaLabel: `${label}: ${text}` });
  };
  for (const core of Object.values(state.knowledge.cores)) {
    add(semanticKey(state.sessionId, coreRef(core.id)), core.id.replaceAll("-", " "), "Core");
    for (const object of Object.values(core.objects)) {
      if (object.status !== "valid") continue;
      const ref = objectRef(core.id, object.id);
      const rep = inline.find(r => r.target && semanticKey(state.sessionId, r.target) === semanticKey(state.sessionId, ref));
      add(semanticKey(state.sessionId, ref), object.value.text, rep?.kind ?? "Knowledge", rep ? { representationId: rep.id, ...(rep.role === "dominant" ? { role: "primary" } : {}) } : {});
    }
    for (const support of Object.values(core.supports)) {
      if (support.status !== "valid") continue;
      const key = semanticKey(state.sessionId, { kind: "SUPPORT", coreId: core.id, id: support.id });
      if (context.has(key) || inspectedCoreId === core.id) add(key, support.value.text, "Support");
    }
    for (const relation of Object.values(core.relations)) {
      if (relation.status !== "valid" || core.objects[relation.value.fromObjectId]?.status !== "valid" || core.objects[relation.value.toObjectId]?.status !== "valid") continue;
      edges.push({ id: rendererId(semanticKey(state.sessionId, { kind: "RELATION", coreId: core.id, id: relation.id })),
        source: rendererId(semanticKey(state.sessionId, objectRef(core.id, relation.value.fromObjectId))),
        target: rendererId(semanticKey(state.sessionId, objectRef(core.id, relation.value.toObjectId))),
        type: "smoothstep", selectable: false, ariaLabel: relation.value.text,
        style: { stroke: core.id === state.knowledge.currentCoreId || core.id === inspectedCoreId ? "#839991" : "#c4ccc7", strokeWidth: 1.5 } });
    }
  }
  for (const rep of projection.attention.representations) if (!inline.some(r => r.id === rep.id)) {
    add(transientKey(state.sessionId, "REPRESENTATION", rep.id), "Grounded representation slot; source payload belongs to the host.", rep.kind,
      { representationId: rep.id, role: rep.role === "dominant" ? "primary" : "context" });
  }
  for (const block of projection.workSurface?.blocks ?? []) {
    add(transientKey(state.sessionId, "WORK", block.id), `${block.status.replaceAll("_", " ")} · ${block.id.replaceAll("-", " ")}`, `${block.kind} · Work`, { workId: block.id, role: "context" });
  }
  if (projection.attention.cue && state.cue.active?.id === projection.attention.cue.cueId) {
    add(semanticKey(state.sessionId, { kind: "CUE", id: state.cue.active.id }), state.cue.active.text, state.cue.active.kind,
      { role: projection.attention.cue.role === "dominant" ? "primary" : "context" });
  }
  return { nodes, edges };
}

/** Frame the same inspected-Core elements the renderer will reveal, including
 * cached Support. Hidden, invalid or unrelated geometry does not enter the frame.
 */
export function inspectionRects(state: CoreTeachingState, projection: LearnerProjection, spatial: SpatialState, coreId: string): Rect[] {
  return projectCanvas(state, projection, spatial, coreId).nodes.filter(node => node.data.coreId === coreId)
    .map(node => rectOf(spatial.elements[node.data.spatialKey]!));
}
