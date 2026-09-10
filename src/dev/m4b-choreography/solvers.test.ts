import { describe, expect, it } from 'vitest';
import { solvePresentation, type SolveInput, type SolveResult, type SolverId } from './solvers';
import { CHOREOGRAPHY_SCENARIOS } from './scenarios';
import { teachingScene } from './model';

const solvers: SolverId[] = ['baseline', 'webcola', 'elk'];

function input(orientation: SolveInput['orientation'] = 'horizontal'): SolveInput {
  return {
    nodes: [
      { id: 'first', width: 310, height: 136, home: { x: 120, y: 250 }, role: 'context' },
      { id: 'second', width: 320, height: 174, home: { x: 2220, y: 180 }, role: 'primary' },
      { id: 'third', width: 280, height: 154, home: { x: 2260, y: 420 }, role: 'primary' },
    ],
    edges: [], viewport: { width: 1100, height: 640 }, gap: 36, orientation,
  };
}

function verifyGeometry(request: SolveInput, result: SolveResult): void {
  expect(Object.keys(result.positions).sort()).toEqual(request.nodes.map(node => node.id).sort());
  expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(Math.min(...Object.values(result.positions).map(position => position.x))).toBeCloseTo(0, 6);
  expect(Math.min(...Object.values(result.positions).map(position => position.y))).toBeCloseTo(0, 6);
  for (let i = 0; i < request.nodes.length; i += 1) {
    for (let j = i + 1; j < request.nodes.length; j += 1) {
      const a = request.nodes[i];
      const b = request.nodes[j];
      const pa = result.positions[a.id];
      const pb = result.positions[b.id];
      const separation = Math.max(pb.x - pa.x - a.width, pa.x - pb.x - b.width,
        pb.y - pa.y - a.height, pa.y - pb.y - b.height);
      expect(separation).toBeGreaterThanOrEqual(request.gap - 0.001);
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe.each(solvers)('%s selected presentation adapter', solver => {
  it.each(['horizontal', 'vertical'] as const)('settles measured %s geometry deterministically without mutating inputs', async orientation => {
    const request = deepFreeze(input(orientation));
    const original = JSON.stringify(request);
    const first = await solvePresentation(solver, request);
    const second = await solvePresentation(solver, request);
    verifyGeometry(request, first);
    verifyGeometry(request, second);
    for (const node of request.nodes) {
      expect(Math.abs(first.positions[node.id].x - second.positions[node.id].x)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(first.positions[node.id].y - second.positions[node.id].y)).toBeLessThanOrEqual(0.1);
    }
    expect(JSON.stringify(request)).toBe(original);
  });

  it('keeps narrow targets in a measured vertical composition', async () => {
    const request = input('vertical');
    request.viewport = { width: 342, height: 730 };
    const result = await solvePresentation(solver, request);
    verifyGeometry(request, result);
    for (let index = 1; index < request.nodes.length; index += 1) {
      const previous = request.nodes[index - 1];
      const node = request.nodes[index];
      expect(result.positions[node.id].y).toBeGreaterThanOrEqual(result.positions[previous.id].y + previous.height + request.gap - 0.001);
      expect(result.positions[node.id].x + node.width).toBeLessThanOrEqual(request.viewport.width + 0.001);
    }
  });

  it('does not let reversing a real relation reverse preferred reading order', async () => {
    for (const orientation of ['horizontal', 'vertical'] as const) {
      const request = input(orientation);
      request.edges = [{ id: 'accepted-relation', source: 'third', target: 'first' }];
      const result = await solvePresentation(solver, request);
      verifyGeometry(request, result);
      const axis = orientation === 'horizontal' ? 'x' : 'y';
      expect(result.positions.first[axis]).toBeLessThan(result.positions.second[axis]);
      expect(result.positions.second[axis]).toBeLessThan(result.positions.third[axis]);
    }
  });

  it('honors long measured text without inventing a smaller box', async () => {
    const request = input('vertical');
    request.nodes[0].height = 914.5;
    const original = JSON.stringify(request);
    const result = await solvePresentation(solver, request);
    verifyGeometry(request, result);
    expect(result.positions.second.y).toBeGreaterThanOrEqual(914.5 + request.gap - 0.001);
    expect(JSON.stringify(request)).toBe(original);
  });

  it('handles five selected boxes without putting them in a single oversized desktop row', async () => {
    const request = input();
    request.nodes = Array.from({ length: 5 }, (_, index) => ({
      id: `target-${index}`, width: 342, height: 150 + (index % 2) * 35,
      home: { x: index * 2100, y: index * 40 }, role: 'primary' as const,
    }));
    const result = await solvePresentation(solver, request);
    verifyGeometry(request, result);
    const maxRight = Math.max(...request.nodes.map(node => result.positions[node.id].x + node.width));
    expect(maxRight).toBeLessThanOrEqual(request.viewport.width + 0.001);
    expect(new Set(Object.values(result.positions).map(position => Math.round(position.y))).size).toBeGreaterThan(1);
  });

  it('supports eight selected objects while leaving distant home geometry byte-for-byte intact', async () => {
    const request = input('vertical');
    request.nodes = Array.from({ length: 8 }, (_, index) => ({
      id: `selected-${index}`, width: 286 + index, height: 72 + index * 7,
      home: { x: index * 8000.123, y: index * -701.29 }, role: 'primary' as const,
    }));
    const original = JSON.stringify(request.nodes.map(node => node.home));
    const result = await solvePresentation(solver, request);
    verifyGeometry(request, result);
    expect(JSON.stringify(request.nodes.map(node => node.home))).toBe(original);
    expect(Object.keys(result.positions)).toHaveLength(8);
  });

  it('rejects relations to non-selected nodes instead of expanding the world', async () => {
    const request = input();
    request.edges = [{ id: 'outside-edge', source: 'first', target: 'unselected-history' }];
    await expect(solvePresentation(solver, request)).rejects.toThrow('selected objects only');
  });
});

it('reports invalid measurements explicitly, without returning another solver result', async () => {
  const request = input();
  request.nodes[1].height = Number.NaN;
  await expect(solvePresentation('webcola', request)).rejects.toThrow('Invalid measured');
});

it.each(solvers)('%s separates the actual measured History comparison including its long accepted edge', async solver => {
  const step = CHOREOGRAPHY_SCENARIOS.find(scenario => scenario.id === 'history-compare')!.steps[1];
  const scene = teachingScene(step);
  const selected = scene.items.filter(item => scene.required.includes(item.id));
  // Recorded real-browser boxes at 1280×720: three complete propositions and
  // two source placeholders. The longer accepted edge skips a layout layer.
  const request: SolveInput = {
    nodes: selected.map(item => ({ id: item.id, width: 392,
      height: item.kind === 'REPRESENTATION' ? 148 : 188,
      home: { x: 0, y: 0 }, role: 'primary' })),
    edges: scene.edges.filter(edge => scene.required.includes(edge.source) && scene.required.includes(edge.target)),
    viewport: { width: 1240, height: 453 }, gap: 32, orientation: 'horizontal',
  };
  expect(request.nodes).toHaveLength(5);
  expect(request.edges).toHaveLength(2);
  const result = await solvePresentation(solver, deepFreeze(request));
  verifyGeometry(request, result);
  expect(Math.max(...request.nodes.map(node => result.positions[node.id].x + node.width))).toBeLessThanOrEqual(1240.001);
  expect(Math.max(...request.nodes.map(node => result.positions[node.id].y + node.height))).toBeLessThanOrEqual(453.001);
});
