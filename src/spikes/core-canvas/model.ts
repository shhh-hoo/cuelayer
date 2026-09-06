// Script-only knowledge. No React Flow, coordinates, layout, provider or production state.
export type Content = { kind: "text"; text: string } | { kind: "math"; tex: string; label: string };
export type CoreNode = { id: string; content: Content };
export type CoreRelation = { id: string; source: string; target: string; kind: "branch" | "contrast" };
export type CoreModel = { id: string; nodes: CoreNode[]; relations: CoreRelation[] };
export type Support = { id: string; coreId: string; text: string };
export type Lesson = { cores: CoreModel[]; supports: Support[]; currentCoreId: string };

export type Operation =
  | { kind: "begin"; core: CoreModel }
  | { kind: "grow"; coreId: string; nodes: CoreNode[]; relations: CoreRelation[] }
  | { kind: "revise"; coreId: string; nodeId: string; content: Content }
  | { kind: "support"; support: Support };

export function applyOperation(lesson: Lesson, operation: Operation): Lesson {
  if (operation.kind === "begin") return {
    ...lesson, cores: [...lesson.cores, operation.core], currentCoreId: operation.core.id,
  };
  // Retaining displaced Supports is a reversible spike assumption, not product policy.
  if (operation.kind === "support") return { ...lesson, supports: [...lesson.supports, operation.support] };
  return { ...lesson, cores: lesson.cores.map(core => {
    if (core.id !== operation.coreId) return core;
    if (operation.kind === "grow") return {
      ...core, nodes: [...core.nodes, ...operation.nodes], relations: [...core.relations, ...operation.relations],
    };
    return { ...core, nodes: core.nodes.map(node => node.id === operation.nodeId ? { ...node, content: operation.content } : node) };
  }) };
}

export function lessonCounts(lesson: Lesson) {
  return {
    nodes: lesson.cores.reduce((n, core) => n + core.nodes.length, 0),
    relations: lesson.cores.reduce((n, core) => n + core.relations.length, 0),
    supports: lesson.supports.length,
    parked: lesson.cores.filter(core => core.id !== lesson.currentCoreId).length,
  };
}
