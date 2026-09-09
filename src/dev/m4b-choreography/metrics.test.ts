import { describe, expect, it } from 'vitest';
import { compositionMetrics, type MetricNode } from './metrics';

function node(id: string, x: number, y: number, extra: Partial<MetricNode> = {}): MetricNode {
  return {
    id, position: { x, y }, width: 100, height: 50,
    fontSize: 24, minimumFontSize: 18, required: true, ...extra,
  };
}

const viewport = { width: 400, height: 300 };

describe('presentation composition metrics', () => {
  it('measures the exact required set without including distant unselected history', () => {
    const result = compositionMetrics([
      node('a', -20, 40), node('b', 100, 140), node('history', 5000, -900, { required: false }),
    ], [], viewport, 20, 1, {}, {});
    expect(result.bounds).toEqual({ x: -20, y: 40, width: 220, height: 150 });
    expect(result.requiredCount).toBe(2);
    expect(result.requiredZoom).toBe(1);
    expect(result.readable).toBe(true);
  });

  it('reports capacity failure both when text is too small and when its required bounds do not fit', () => {
    const nodes = [node('a', 0, 0, { width: 800 })];
    const fullSize = compositionMetrics(nodes, [], viewport, 20, 1, {}, {});
    expect(fullSize.requiredZoom).toBe(0.5);
    expect(fullSize.effectiveMinimumFontSize).toBe(24);
    expect(fullSize.readable).toBe(false);
    const fitSize = compositionMetrics(nodes, [], viewport, 20, 0.5, {}, {});
    expect(fitSize.effectiveMinimumFontSize).toBe(12);
    expect(fitSize.readable).toBe(false);
  });

  it('accepts exact viewport and font-size boundaries and checks each object’s own minimum', () => {
    const nodes = [node('a', 0, 0, { width: 400, height: 300, fontSize: 18 })];
    expect(compositionMetrics(nodes, [], viewport, 0, 1, {}, {}).readable).toBe(true);
    expect(compositionMetrics(nodes, [], viewport, 0, 1.001, {}, {}).readable).toBe(false);
    expect(compositionMetrics(nodes, [], viewport, 0, 0.999, {}, {}).readable).toBe(false);
    nodes.push(node('b', 0, 0, { fontSize: 23, minimumFontSize: 24 }));
    expect(compositionMetrics(nodes, [], viewport, 0, 1, {}, {}).readable).toBe(false);
  });

  it('tolerates subpixel solver rounding in geometry only, without relaxing font floors', () => {
    const region = { width: 1240, height: 600 };
    const measured = node('webcola', 0, 0, { width: 1240.000002, height: 600.000002, fontSize: 18 });
    const measure = (extra: Partial<MetricNode> = {}, zoom = 1) => compositionMetrics(
      [{ ...measured, ...extra }], [], region, 0, zoom, {}, {},
    );
    expect(measure().readable).toBe(true);
    expect(measure({ width: 1240.001 }).readable).toBe(true);
    expect(measure({ width: 1240.001001 }).readable).toBe(false);
    expect(measure({ height: 600.001001 }).readable).toBe(false);
    expect(measure({ fontSize: 17.999999 }).readable).toBe(false);
    expect(measure({}, 0.999999).readable).toBe(false);
    // The raw fit scale remains an honest numeric diagnostic.
    expect(measure().requiredZoom).toBe(Math.min(1240 / 1240.000002, 600 / 600.000002));
  });

  it('counts overlap pairs once and excludes them from the independent gap count', () => {
    const overlap = compositionMetrics([node('a', 0, 0), node('b', 99, 49)], [], viewport, 20, 1, {}, {});
    expect(overlap.selectedOverlapCount).toBe(1);
    expect(overlap.gapViolations).toBe(0);
    const touching = compositionMetrics([node('a', 0, 0), node('b', 100, 0)], [], viewport, 20, 1, {}, {});
    expect(touching.selectedOverlapCount).toBe(0);
    expect(touching.gapViolations).toBe(1);
    const exactGap = compositionMetrics([node('a', 0, 0), node('b', 120, 0)], [], viewport, 20, 1, {}, {});
    expect(exactGap.gapViolations).toBe(0);
  });

  it('uses the shortest edge-to-edge distance for diagonally separated rectangles', () => {
    const nodes = [node('a', 0, 0), node('b', 103, 54)];
    expect(compositionMetrics(nodes, [], viewport, 5, 1, {}, {}).gapViolations).toBe(0);
    expect(compositionMetrics(nodes, [], viewport, 5.001, 1, {}, {}).gapViolations).toBe(1);
  });

  it('separates temporary composition displacement from immutable original homes', () => {
    const homes = { a: { x: 10, y: 20 }, b: { x: 120, y: 20 } };
    const result = compositionMetrics([
      node('a', 13, 24), node('b', 120, 20),
    ], [], viewport, 10, 1, homes, { ...homes, newlyEstablished: { x: 800, y: 100 } });
    expect(result.homeCoordinatesChanged).toBe(false);
    expect(result.temporarilyMoved).toBe(1);
    expect(result.maximumTemporaryDisplacement).toBe(5);
    expect(compositionMetrics([], [], viewport, 0, 1, homes, {
      ...homes, a: { x: 10 + 1e-10, y: 20 },
    }).homeCoordinatesChanged).toBe(true);
    expect(compositionMetrics([], [], viewport, 0, 1, homes, {}).homeCoordinatesChanged).toBe(true);
    expect(homes.a).toEqual({ x: 10, y: 20 });
  });

  it('uses a node’s explicit home for displacement when given', () => {
    const result = compositionMetrics([node('a', 30, 40, { home: { x: 0, y: 0 } })],
      [], viewport, 0, 1, { a: { x: 30, y: 40 } }, { a: { x: 30, y: 40 } });
    expect(result.maximumTemporaryDisplacement).toBe(50);
    expect(result.homeCoordinatesChanged).toBe(false);
  });

  it('counts an unselected node returning home without expanding the required framing', () => {
    const homes = { selected: { x: 0, y: 0 }, returning: { x: 1000, y: 1000 } };
    const measure = (position: { x: number; y: number }) => compositionMetrics([
      node('selected', 0, 0), node('returning', position.x, position.y, { required: false }),
    ], [], viewport, 20, 1, homes, homes);
    const returning = measure({ x: 1003, y: 1004 });
    expect(returning.temporarilyMoved).toBe(1);
    expect(returning.maximumTemporaryDisplacement).toBe(5);
    expect(returning.requiredCount).toBe(1);
    expect(returning.bounds).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    const settled = measure(homes.returning);
    expect(settled.temporarilyMoved).toBe(0);
    expect(settled.maximumTemporaryDisplacement).toBe(0);
    expect(settled.homeCoordinatesChanged).toBe(false);
  });

  it('counts strict centre-line crossings only for edges with both endpoints required', () => {
    const nodes = [node('a', 0, 0), node('b', 200, 200), node('c', 0, 200), node('d', 200, 0)];
    const edges = [{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }, { source: 'a', target: 'd' }];
    expect(compositionMetrics(nodes, edges, viewport, 0, 1, {}, {}).edgeCrossings).toBe(1);
    nodes[3].required = false;
    expect(compositionMetrics(nodes, edges, viewport, 0, 1, {}, {}).edgeCrossings).toBe(0);
  });

  it('does not count shared endpoints, collinear edges or dangling relations as crossings', () => {
    const nodes = [node('a', 0, 0), node('b', 100, 0), node('c', 200, 0), node('d', 300, 0)];
    const edges = [
      { source: 'a', target: 'c' }, { source: 'b', target: 'd' },
      { source: 'a', target: 'd' }, { source: 'missing', target: 'a' },
    ];
    expect(compositionMetrics(nodes, edges, viewport, 0, 1, {}, {}).edgeCrossings).toBe(0);
  });

  it('handles an empty required composition without manufacturing a capacity failure', () => {
    expect(compositionMetrics([], [], viewport, 20, 1, {}, {})).toEqual({
      homeCoordinatesChanged: false, temporarilyMoved: 0, selectedOverlapCount: 0,
      gapViolations: 0, effectiveMinimumFontSize: 0, requiredZoom: 1, bounds: undefined,
      maximumTemporaryDisplacement: 0, readable: true, edgeCrossings: 0, requiredCount: 0,
    });
  });
});
