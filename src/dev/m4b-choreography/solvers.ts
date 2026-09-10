import ELK from 'elkjs/lib/elk.bundled.js';
import { Layout } from 'webcola';

export type SolverId = 'baseline' | 'webcola' | 'elk';
export type Position = { x: number; y: number };
export type SolveNode = {
  id: string;
  width: number;
  height: number;
  home: Position;
  role: 'primary' | 'context';
};
export type SolveInput = {
  nodes: SolveNode[];
  edges: { id: string; source: string; target: string }[];
  viewport: { width: number; height: number };
  gap: number;
  orientation: 'horizontal' | 'vertical';
};
export type SolveResult = {
  positions: Record<string, Position>;
  elapsedMs: number;
  notes: string[];
};

// Development hypothesis only: solvers receive measured selected rectangles,
// never the persistent lesson world. Their mutable working graphs are copies.
// Output is local presentation geometry; it cannot write an object's home.
function validateInput(input: SolveInput): void {
  const ids = new Set(input.nodes.map(node => node.id));
  if (ids.size !== input.nodes.length) throw new Error('Presentation IDs must be unique.');
  if (input.nodes.length > 8) throw new Error('This presentation spike is limited to eight selected objects.');
  if (!Number.isFinite(input.gap) || input.gap < 0) throw new Error('Presentation separation must be non-negative.');
  if (![input.viewport.width, input.viewport.height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Presentation viewport must have positive finite dimensions.');
  }
  for (const node of input.nodes) {
    if (!node.id || ![node.width, node.height].every(value => Number.isFinite(value) && value > 0)
      || ![node.home.x, node.home.y].every(Number.isFinite)) {
      throw new Error(`Invalid measured presentation rectangle: ${node.id}`);
    }
  }
  if (input.edges.some(edge => !ids.has(edge.source) || !ids.has(edge.target))) {
    throw new Error('Presentation relations must reference selected objects only.');
  }
}

function measuredRows(input: SolveInput): number[][] {
  const rows: number[][] = [];
  let width = 0;
  input.nodes.forEach((node, index) => {
    if (input.orientation === 'vertical' || rows.length === 0
      || width + input.gap + node.width > input.viewport.width) {
      rows.push([index]);
      width = node.width;
    } else {
      rows.at(-1)!.push(index);
      width += input.gap + node.width;
    }
  });
  return rows;
}

function baseline(input: SolveInput, rows: number[][]): Record<string, Position> {
  let y = 0;
  const entries: [string, Position][] = [];
  for (const row of rows) {
    let x = 0;
    for (const index of row) {
      const node = input.nodes[index];
      entries.push([node.id, { x, y }]);
      x += node.width + input.gap;
    }
    y += Math.max(...row.map(index => input.nodes[index].height)) + input.gap;
  }
  return Object.fromEntries(entries);
}

function webcola(input: SolveInput, rows: number[][]): Record<string, Position> {
  const seed = baseline(input, rows);
  const indices = new Map(input.nodes.map((node, index) => [node.id, index]));
  const nodes = input.nodes.map(node => ({
    id: node.id,
    x: seed[node.id].x + node.width / 2,
    y: seed[node.id].y + node.height / 2,
    // Inflating each rectangle by one gap gives half a gap on each side.
    width: node.width + input.gap,
    height: node.height + input.gap,
  }));
  const constraints: { axis: string; left: number; right: number; gap: number; equality?: boolean }[] = [];
  rows.forEach((row, rowIndex) => {
    row.slice(1).forEach((index, column) => {
      const previous = row[column];
      constraints.push({ axis: 'x', left: previous, right: index,
        gap: (input.nodes[previous].width + input.nodes[index].width) / 2 + input.gap });
      constraints.push({ axis: 'y', left: row[0], right: index,
        gap: (input.nodes[index].height - input.nodes[row[0]].height) / 2, equality: true });
    });
    if (rowIndex === 0) return;
    constraints.push({ axis: 'x', left: rows[0][0], right: row[0],
      gap: (input.nodes[row[0]].width - input.nodes[rows[0][0]].width) / 2, equality: true });
    for (const previous of rows[rowIndex - 1]) {
      for (const current of row) {
        constraints.push({ axis: 'y', left: previous, right: current,
          gap: (input.nodes[previous].height + input.nodes[current].height) / 2 + input.gap });
      }
    }
  });
  new Layout()
    .nodes(nodes)
    .links(input.edges.map(edge => ({ source: indices.get(edge.source)!, target: indices.get(edge.target)! })))
    .constraints(constraints)
    .avoidOverlaps(true)
    .handleDisconnected(false)
    .convergenceThreshold(1e-4)
    // No timer, tick rendering, or ongoing force simulation during teaching.
    .start(0, 30, 80, 0, false, false);
  return Object.fromEntries(nodes.map((node, index) => [node.id, {
    x: node.x - input.nodes[index].width / 2,
    y: node.y - input.nodes[index].height / 2,
  }]));
}

const elk = new ELK();

async function elkLayout(input: SolveInput, rows: number[][]): Promise<Record<string, Position>> {
  const horizontal = input.orientation === 'horizontal';
  const useBox = horizontal && input.edges.length === 0;
  const columns = new Map(rows.flatMap(row => row.map((index, column) => [index, column] as const)));
  const rowWidth = input.nodes.reduce((sum, node) => sum + node.width, 0)
    + Math.max(0, input.nodes.length - 1) * input.gap;
  const aspectRatio = rows.length === 1
    ? rowWidth / Math.max(...input.nodes.map(node => node.height))
    : input.viewport.width / input.viewport.height;
  const result = await elk.layout({
    id: 'temporary-presentation',
    layoutOptions: {
      'elk.algorithm': useBox ? 'box' : 'layered',
      'elk.box.packingMode': 'SIMPLE',
      'elk.aspectRatio': String(aspectRatio),
      'elk.direction': horizontal ? 'RIGHT' : 'DOWN',
      'elk.randomSeed': '1',
      'elk.padding': '[top=0,left=0,bottom=0,right=0]',
      'elk.spacing.nodeNode': String(input.gap),
      // Long-edge dummy nodes use edge–node spacing inside a layer. Leaving
      // that at ELK's 10px default can violate the requested rectangle gap.
      'elk.spacing.edgeNode': String(input.gap),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(input.gap),
      'elk.separateConnectedComponents': 'false',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.nodePlacement.strategy': 'SIMPLE',
      'elk.partitioning.activate': 'true',
    },
    children: input.nodes.map((node, index) => ({
      id: node.id, width: node.width, height: node.height,
      // Solver-only ordering constraints, not semantic groups or invented links.
      layoutOptions: {
        'elk.partitioning.partition': String(horizontal ? columns.get(index) : index),
        'elk.priority': String(input.nodes.length - index),
      },
    })),
    edges: input.edges.map(edge => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  });
  return Object.fromEntries((result.children ?? []).map(node => [node.id, { x: node.x!, y: node.y! }]));
}

function normalizeAndValidate(input: SolveInput, positions: Record<string, Position>): Record<string, Position> {
  if (Object.keys(positions).length !== input.nodes.length
    || input.nodes.some(node => !positions[node.id]
      || ![positions[node.id].x, positions[node.id].y].every(Number.isFinite))) {
    throw new Error('Presentation solver returned missing, extra, or non-finite positions.');
  }
  const left = Math.min(...Object.values(positions).map(position => position.x));
  const top = Math.min(...Object.values(positions).map(position => position.y));
  const normalized = Object.fromEntries(input.nodes.map(node => [node.id, {
    x: positions[node.id].x - left, y: positions[node.id].y - top,
  }]));
  for (let i = 0; i < input.nodes.length; i += 1) {
    for (let j = i + 1; j < input.nodes.length; j += 1) {
      const a = input.nodes[i];
      const b = input.nodes[j];
      const pa = normalized[a.id];
      const pb = normalized[b.id];
      const separated = pa.x + a.width + input.gap <= pb.x + 0.001
        || pb.x + b.width + input.gap <= pa.x + 0.001
        || pa.y + a.height + input.gap <= pb.y + 0.001
        || pb.y + b.height + input.gap <= pa.y + 0.001;
      if (!separated) throw new Error(`Presentation solver violated separation: ${a.id}, ${b.id}`);
    }
  }
  return normalized;
}

export async function solvePresentation(solver: SolverId, input: SolveInput): Promise<SolveResult> {
  const started = performance.now();
  validateInput(input);
  const rows = measuredRows(input);
  const notes = [input.orientation === 'horizontal'
    ? `Measured horizontal composition with ${rows.length} row(s) allowed.`
    : 'Measured vertical composition.'];
  if (solver === 'webcola') notes.push('Finite WebCola solve; hard separation is verified after solving. No visible simulation.');
  if (solver === 'elk') notes.push(input.orientation === 'horizontal' && input.edges.length === 0
    ? 'ELK Box packs edgeless selections with measured boxes, input priorities and viewport aspect ratio.'
    : 'ELK Layered uses temporary order constraints and only accepted selected relations.');
  notes.push('Roles retain input order; presentation emphasis is applied by the renderer. Readable capacity is measured separately.');
  if (input.nodes.length === 0) return { positions: {}, elapsedMs: performance.now() - started, notes };
  const positions = input.nodes.length === 1 ? baseline(input, rows)
    : solver === 'baseline' ? baseline(input, rows)
      : solver === 'webcola' ? webcola(input, rows)
        : await elkLayout(input, rows);
  return { positions: normalizeAndValidate(input, positions), elapsedMs: performance.now() - started, notes };
}
