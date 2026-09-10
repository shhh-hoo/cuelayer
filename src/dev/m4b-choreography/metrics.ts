export type MetricNode = {
  id: string;
  home?: { x: number; y: number };
  position: { x: number; y: number };
  width: number;
  height: number;
  fontSize: number;
  minimumFontSize: number;
  required: boolean;
};

export type MetricEdge = { source: string; target: string };

type Point = { x: number; y: number };
type Bounds = Point & { width: number; height: number };
const FIT_TOLERANCE_PX = 0.001;

function boundsOf(nodes: MetricNode[]): Bounds | undefined {
  if (nodes.length === 0) return undefined;
  const x = Math.min(...nodes.map(node => node.position.x));
  const y = Math.min(...nodes.map(node => node.position.y));
  return {
    x,
    y,
    width: Math.max(...nodes.map(node => node.position.x + node.width)) - x,
    height: Math.max(...nodes.map(node => node.position.y + node.height)) - y,
  };
}

function centre(node: MetricNode): Point {
  return { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function countCrossings(nodes: MetricNode[], edges: MetricEdge[]): number {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const visibleEdges = edges.filter(edge => edge.source !== edge.target
    && byId.has(edge.source) && byId.has(edge.target));
  let crossings = 0;
  for (let i = 0; i < visibleEdges.length; i += 1) {
    for (let j = i + 1; j < visibleEdges.length; j += 1) {
      const first = visibleEdges[i];
      const second = visibleEdges[j];
      if ([first.source, first.target].some(id => id === second.source || id === second.target)) continue;
      const a = centre(byId.get(first.source)!);
      const b = centre(byId.get(first.target)!);
      const c = centre(byId.get(second.source)!);
      const d = centre(byId.get(second.target)!);
      // Approximation: strict centre-line crossings, not rendered curved edges.
      // Shared endpoints, tangencies and collinear overlaps are not crossings.
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) crossings += 1;
    }
  }
  return crossings;
}

export function compositionMetrics(
  nodes: MetricNode[],
  edges: MetricEdge[],
  viewport: { width: number; height: number },
  gap: number,
  actualZoom: number,
  originalHomes: Record<string, Point>,
  currentHomes: Record<string, Point>,
) {
  // Required is the exact set that must fit together; distant unselected world
  // history must not silently affect framing or the readable-capacity result.
  const required = nodes.filter(node => node.required);
  const bounds = boundsOf(required);
  let selectedOverlapCount = 0;
  let gapViolations = 0;
  for (let i = 0; i < required.length; i += 1) {
    for (let j = i + 1; j < required.length; j += 1) {
      const a = required[i];
      const b = required[j];
      const dx = Math.max(a.position.x - b.position.x - b.width, b.position.x - a.position.x - a.width);
      const dy = Math.max(a.position.y - b.position.y - b.height, b.position.y - a.position.y - a.height);
      if (dx < 0 && dy < 0) selectedOverlapCount += 1;
      // Shortest Euclidean distance between rectangle edges. Each unordered
      // pair counts once; overlapping pairs are excluded from gap violations.
      else if (Math.hypot(Math.max(0, dx), Math.max(0, dy)) < gap) gapViolations += 1;
    }
  }
  // A released object remains temporarily displaced while returning home,
  // even after it leaves the required framing set.
  const displacements = nodes.map(node => {
    const home = node.home ?? currentHomes[node.id] ?? originalHomes[node.id];
    return home ? Math.hypot(node.position.x - home.x, node.position.y - home.y) : 0;
  });
  const requiredZoom = bounds
    ? Math.min(1, viewport.width / bounds.width, viewport.height / bounds.height)
    : 1;
  return {
    // Compare original IDs exactly, with no floating-point tolerance. Newly
    // established homes are allowed, but removal of an original home is not.
    homeCoordinatesChanged: Object.entries(originalHomes).some(([id, original]) => {
      const current = currentHomes[id];
      return !current || original.x !== current.x || original.y !== current.y;
    }),
    temporarilyMoved: displacements.filter(distance => distance > 0).length,
    selectedOverlapCount,
    gapViolations,
    effectiveMinimumFontSize: required.length ? Math.min(...required.map(node => node.fontSize * actualZoom)) : 0,
    requiredZoom,
    bounds,
    maximumTemporaryDisplacement: Math.max(0, ...displacements),
    // Subpixel solver rounding may exceed the region by a few millionths of
    // a pixel. Tolerate only geometry fit; the font-size floor stays exact.
    readable: (!bounds || (bounds.width * actualZoom <= viewport.width + FIT_TOLERANCE_PX
      && bounds.height * actualZoom <= viewport.height + FIT_TOLERANCE_PX))
      && required.every(node => node.fontSize * actualZoom >= node.minimumFontSize),
    edgeCrossings: countCrossings(required, edges),
    requiredCount: required.length,
  };
}
