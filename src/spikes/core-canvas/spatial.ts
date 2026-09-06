import { graphlib, layout } from "@dagrejs/dagre";
import type { CoreModel, CoreNode, Lesson } from "./model";

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Bounds = Point & Size;
export type Camera = Point & { zoom: number };
export type Spatial = {
  coreOrigins: Record<string, Point>;
  positions: Record<string, Point>;
  sizes: Record<string, Size>;
};
export const emptySpatial = (): Spatial => ({ coreOrigins: {}, positions: {}, sizes: {} });
export const nodeSize = (node: CoreNode): Size => ({ width: node.content.kind === "math" ? 280 : 220, height: 84 });
export const SUPPORT_SIZE: Size = { width: 264, height: 124 };

export function boundsOf(rectangles: Bounds[]): Bounds {
  if (!rectangles.length) return { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.min(...rectangles.map(rect => rect.x));
  const y = Math.min(...rectangles.map(rect => rect.y));
  return { x, y, width: Math.max(...rectangles.map(rect => rect.x + rect.width)) - x, height: Math.max(...rectangles.map(rect => rect.y + rect.height)) - y };
}
export function coreBounds(core: CoreModel, spatial: Spatial, absolute = true): Bounds {
  const origin = absolute ? spatial.coreOrigins[core.id] ?? { x: 0, y: 0 } : { x: 0, y: 0 };
  return boundsOf(core.nodes.filter(node => spatial.positions[node.id]).map(node => ({
    x: spatial.positions[node.id]!.x + origin.x, y: spatial.positions[node.id]!.y + origin.y,
    ...(spatial.sizes[node.id] ?? nodeSize(node)),
  })));
}
function overlaps(a: Bounds, b: Bounds) {
  return a.x < b.x + b.width + 24 && a.x + a.width + 24 > b.x && a.y < b.y + b.height + 24 && a.y + a.height + 24 > b.y;
}

// A branch suggestion and, if needed, ONE rightward lane offset. Not an incremental layout engine.
export function placeAdditions(lesson: Lesson, previous: Spatial, visibleWidth: number): Spatial {
  const next: Spatial = { coreOrigins: { ...previous.coreOrigins }, positions: { ...previous.positions }, sizes: { ...previous.sizes } };
  for (const core of lesson.cores) {
    const added = core.nodes.filter(node => !next.positions[node.id]);
    if (!added.length) continue; // Parked and established Cores never go through Dagre again.
    if (!next.coreOrigins[core.id]) {
      const others = lesson.cores.filter(item => next.coreOrigins[item.id]);
      const right = Math.max(0, ...others.map(item => { const b = coreBounds(item, next); return b.x + b.width; }));
      next.coreOrigins[core.id] = { x: others.length ? right + Math.max(1200, visibleWidth) + 320 : 0, y: 0 };
    }
    const addedIds = new Set(added.map(node => node.id));
    const connection = core.relations.find(edge => edge.kind === "branch" && addedIds.has(edge.target) && !addedIds.has(edge.source));
    const anchor = connection ? core.nodes.find(node => node.id === connection.source) : undefined;
    const graph = new graphlib.Graph().setGraph({ rankdir: "TB", ranksep: 64, nodesep: 48 }).setDefaultEdgeLabel(() => ({}));
    const localNodes = anchor ? [anchor, ...added] : added;
    // Dagre mutates node labels: never hand it the renderer's cached dimension objects.
    for (const node of localNodes) graph.setNode(node.id, { ...(next.sizes[node.id] ?? nodeSize(node)) });
    for (const edge of core.relations) {
      if (edge.kind === "branch" && graph.hasNode(edge.source) && graph.hasNode(edge.target)) graph.setEdge(edge.source, edge.target);
    }
    layout(graph);
    const anchorId = anchor?.id ?? added[0]!.id;
    const anchorSize = next.sizes[anchorId] ?? nodeSize(localNodes.find(node => node.id === anchorId)!);
    const anchorSuggestion = graph.node(anchorId);
    const fixed = next.positions[anchorId] ?? { x: 0, y: 0 };
    const suggestions = added.map(node => {
      const size = next.sizes[node.id] ?? nodeSize(node);
      const proposed = graph.node(node.id);
      return { id: node.id, x: fixed.x + proposed.x - size.width / 2 - (anchorSuggestion.x - anchorSize.width / 2), y: fixed.y + proposed.y - size.height / 2 - (anchorSuggestion.y - anchorSize.height / 2), ...size };
    });
    const established = core.nodes.filter(node => next.positions[node.id]).map(node => ({ ...next.positions[node.id]!, ...(next.sizes[node.id] ?? nodeSize(node)) }));
    const candidate = boundsOf(suggestions);
    const occupied = boundsOf(established);
    const offset = established.some(rect => overlaps(candidate, rect)) ? occupied.x + occupied.width + 48 - candidate.x : 0;
    for (const suggested of suggestions) {
      next.positions[suggested.id] = { x: suggested.x + offset, y: suggested.y };
      next.sizes[suggested.id] = { width: suggested.width, height: suggested.height };
    }
  }
  return next;
}

export function moveSpatial(spatial: Spatial, id: string, position: Point): Spatial {
  return id.startsWith("core:")
    ? { ...spatial, coreOrigins: { ...spatial.coreOrigins, [id.slice(5)]: position } }
    : { ...spatial, positions: { ...spatial.positions, [id]: position } };
}
export function supportPosition(core: CoreModel, spatial: Spatial, age: number): Point {
  const bounds = coreBounds(core, spatial, false);
  return { x: bounds.x + bounds.width + 56, y: bounds.y + 40 - age * (SUPPORT_SIZE.height + 28) };
}

// Camera follows semantic current content, never whichever Core happens to be at the origin.
export function followCamera(current: Camera, surface: Size, target: Bounds, detail: Bounds, force = false): Camera {
  const padding = surface.width < 600 ? 24 : 56;
  const width = Math.max(1, surface.width - padding * 2);
  const height = Math.max(1, surface.height - padding * 2);
  const fits = target.x * current.zoom + current.x >= padding && target.y * current.zoom + current.y >= padding
    && (target.x + target.width) * current.zoom + current.x <= surface.width - padding
    && (target.y + target.height) * current.zoom + current.y <= surface.height - padding;
  if (!force && fits && current.zoom >= 0.6 && current.zoom <= 1.1) return current;
  const fitZoom = Math.min(1, width / target.width, height / target.height);
  const focus = fitZoom < 0.6 ? detail : target;
  const zoom = Math.min(1, Math.max(0.6, Math.min(width / focus.width, height / focus.height)));
  return { x: surface.width / 2 - (focus.x + focus.width / 2) * zoom, y: surface.height / 2 - (focus.y + focus.height / 2) * zoom, zoom };
}
