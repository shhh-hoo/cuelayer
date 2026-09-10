import type { ScenarioStep } from "./scenarios.ts";
import { attentionFrame } from "../../canvas-spatial/canvas-projection.ts";
import { coreRef, emptySpatial, objectRef, semanticKey, type SpatialState } from "../../canvas-spatial/spatial.ts";
import type { Rect, Size } from "../../canvas-spatial/geometry.ts";

// Art-directed geometry for the selected visual sample, separate from the
// general spatial allocator and accepted lesson state. Reserved neighborhoods
// keep each established object still throughout this particular teaching story.
export function sampleSize(compact: boolean): Size {
  return compact ? { width: 390, height: 844 } : { width: 1672, height: 941 };
}

export function sampleSpatial(step: ScenarioStep, compact: boolean): SpatialState {
  const spatial = emptySpatial(step.state.sessionId);
  const size = sampleSize(compact);
  const locations: Record<string, Rect> = compact ? {
    catalyst: { x: 28, y: 190, width: 330, height: 135 },
    "alternative-path": { x: 28, y: 378, width: 300, height: 130 },
    "lower-ea": { x: 28, y: 578, width: 300, height: 145 },
    rate: { x: 28, y: 225, width: 330, height: 180 },
    equation: { x: 28, y: 485, width: 330, height: 100 },
  } : {
    catalyst: { x: 148, y: 230, width: 1090, height: 138 },
    "alternative-path": { x: 148, y: 435, width: 752, height: 138 },
    "lower-ea": { x: 148, y: 653, width: 782, height: 145 },
    rate: { x: 148, y: 245, width: 1100, height: 200 },
    equation: { x: 148, y: 525, width: 1100, height: 170 },
  };
  for (const core of Object.values(step.state.knowledge.cores)) {
    const offset = core.id === "catalysts" ? 0 : size.width + 280;
    const position = { x: offset + (compact ? 26 : 142), y: compact ? 108 : 94 };
    spatial.coreOrigins[core.id] = position;
    const key = semanticKey(step.state.sessionId, coreRef(core.id));
    spatial.elements[key] = { key, kind: "CORE", coreId: core.id, position,
      size: { width: compact ? 340 : 1200, height: compact ? 65 : 110 } };
    for (const object of Object.values(core.objects)) {
      const rect = locations[object.id];
      if (!rect || object.status !== "valid") continue;
      const objectKey = semanticKey(step.state.sessionId, objectRef(core.id, object.id));
      spatial.elements[objectKey] = { key: objectKey, kind: "OBJECT", coreId: core.id,
        position: { x: rect.x + offset, y: rect.y }, size: { width: rect.width, height: rect.height }, anchorKey: key };
    }
  }
  return spatial;
}

/** Reserve the selected composition's margins while preserving M4A's actual
 * primary references. This sample camera frames a teaching neighborhood; it
 * does not rewrite semantic attention or move its objects on each update.
 */
export function sampleFrame(step: ScenarioStep, spatial: SpatialState, surface: Size, compact: boolean, coreId = step.state.knowledge.currentCoreId) {
  const frame = attentionFrame(step.state, step.projection, spatial);
  const size = sampleSize(compact);
  const zoom = Math.min(1, surface.width / size.width, surface.height / size.height);
  const pad = (surface.width < 600 ? 20 : 48) / Math.max(zoom, 0.01);
  const offset = coreId === "catalysts" ? 0 : size.width + 280;
  return { ...frame, all: [{ x: offset + pad, y: pad, width: size.width - 2 * pad, height: size.height - 2 * pad }] };
}
