import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { Content, Lesson } from "./model";
import { coreBounds, nodeSize, supportPosition, SUPPORT_SIZE, type Bounds, type Spatial } from "./spatial";

export type CanvasData = {
  coreId: string;
  status: "current" | "parked";
  inspected: boolean;
  content?: Content;
  root?: boolean;
  supportText?: string;
  displaced?: boolean;
};
export type CanvasNode = Node<CanvasData, "knowledge" | "coreOrigin" | "support">;

// React Flow parentId is disposable renderer wiring, never a field on CoreModel.
export function projectCanvas(lesson: Lesson, spatial: Spatial, inspectedCoreId: string | null) {
  const nodes: CanvasNode[] = [];
  const edges: Edge[] = [];
  for (const core of lesson.cores) {
    const origin = spatial.coreOrigins[core.id];
    if (!origin) continue;
    const current = core.id === lesson.currentCoreId;
    const inspected = core.id === inspectedCoreId;
    const data: CanvasData = { coreId: core.id, status: current ? "current" : "parked", inspected };
    nodes.push({ id: `core:${core.id}`, type: "coreOrigin", position: origin, data, dragHandle: ".core-grip", className: "spike-origin", style: { width: 1, height: 1 }, measured: { width: 1, height: 1 }, ariaLabel: `Move ${core.id} Core` });
    for (const node of core.nodes) {
      const position = spatial.positions[node.id];
      if (!position) continue;
      nodes.push({ id: node.id, type: "knowledge", parentId: `core:${core.id}`, position,
        data: { ...data, content: node.content, root: node.id === core.nodes[0]!.id },
        style: { width: nodeSize(node).width }, measured: spatial.sizes[node.id], ariaLabel: node.content.kind === "text" ? node.content.text : node.content.label,
      });
    }
    for (const edge of core.relations) {
      const contrast = edge.kind === "contrast";
      const color = current || inspected ? (contrast ? "#8b958a" : "#748473") : "#d7dbd1";
      edges.push({ id: edge.id, source: edge.source, target: edge.target,
        sourceHandle: contrast ? "contrast-source" : "out", targetHandle: contrast ? "contrast-target" : "in",
        type: "smoothstep", selectable: false,
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        ...(contrast ? { markerStart: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 } } : {}),
        style: { stroke: color, strokeWidth: contrast ? 1 : 1.5, ...(contrast ? { strokeDasharray: "4 4" } : {}) },
      });
    }
    const supports = lesson.supports.filter(support => support.coreId === core.id);
    supports.forEach((support, index) => {
      const age = supports.length - 1 - index;
      nodes.push({ id: support.id, type: "support", parentId: `core:${core.id}`, position: supportPosition(core, spatial, age),
        draggable: false, data: { ...data, supportText: support.text, displaced: age > 0 },
        className: "spike-support-position", style: { ...SUPPORT_SIZE }, measured: spatial.sizes[support.id] ?? SUPPORT_SIZE, ariaLabel: `Support: ${support.text}` });
    });
  }
  return { nodes, edges };
}

export function attentionBounds(lesson: Lesson, spatial: Spatial, coreId: string): Bounds[] {
  const core = lesson.cores.find(item => item.id === coreId)!;
  const bounds = [coreBounds(core, spatial)];
  if (lesson.supports.some(support => support.coreId === coreId)) {
    const position = supportPosition(core, spatial, 0);
    const origin = spatial.coreOrigins[coreId]!;
    bounds.push({ x: origin.x + position.x, y: origin.y + position.y, ...SUPPORT_SIZE });
  }
  return bounds;
}
