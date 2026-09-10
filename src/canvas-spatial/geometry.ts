export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = Point & Size;
export type Viewport = Point & { zoom: number };

export function bounds(rects: Rect[]): Rect | undefined {
  if (!rects.length) return undefined;
  const x = Math.min(...rects.map(r => r.x));
  const y = Math.min(...rects.map(r => r.y));
  return { x, y, width: Math.max(...rects.map(r => r.x + r.width)) - x,
    height: Math.max(...rects.map(r => r.y + r.height)) - y };
}

export function overlaps(a: Rect, b: Rect, gap = 24): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

/** Nearest free translation of a new group. Established rectangles never move.
 * Obstacle boundaries provide finite candidates, including a guaranteed outside lane.
 * Whole-group bounds deliberately prefer breathing room over dense packing.
 */
export function freePosition(size: Size, preferred: Point, occupied: Rect[], gap = 32): Point {
  const dimensions = { width: size.width, height: size.height };
  if (!occupied.some(r => overlaps({ ...preferred, ...dimensions }, r, gap))) return preferred;
  const xs = [...new Set([preferred.x, ...occupied.flatMap(r => [r.x - size.width - gap, r.x + r.width + gap])])];
  const ys = [...new Set([preferred.y, ...occupied.flatMap(r => [r.y - size.height - gap, r.y + r.height + gap])])];
  const candidates = xs.flatMap(x => ys.map(y => ({ x, y })));
  candidates.sort((a, b) => (a.x - preferred.x) ** 2 + (a.y - preferred.y) ** 2
    - (b.x - preferred.x) ** 2 - (b.y - preferred.y) ** 2 || b.y - a.y || b.x - a.x);
  return candidates.find(p => !occupied.some(r => overlaps({ ...p, ...dimensions }, r, gap)))!;
}
