import type { Rect } from './geometry.ts';
export type RelationBox = Rect & { id: string };
/** Measured endpoint routing. Only explicit accepted edges are passed here.
 * A blocked corridor is omitted, never drawn through a canonical label. */
export function routeRelation(source: RelationBox, target: RelationBox, obstacles: RelationBox[]): string | undefined {
  if (source.id === target.id) return undefined;
  const others = obstacles.filter(r => r.id !== source.id && r.id !== target.id);
  const vertical = target.y >= source.y + source.height;
  const a = { x: source.x + 16, y: source.y + source.height + 4 };
  const b = { x: target.x + 16, y: target.y - 6 };
  if (vertical && Math.abs(a.x - b.x) < 1 && !others.some(r => r.x < a.x && r.x + r.width > a.x && r.y < b.y && r.y + r.height > a.y)) {
    return `M${a.x},${a.y} L${b.x},${b.y}`;
  }
  // Bounded graph fixture grammar: right-hand corridor, with no crossing text.
  const right = Math.max(...obstacles.map(r => r.x + r.width)) + 10;
  const y1 = source.y + source.height / 2, y2 = target.y + target.height / 2;
  if (others.some(r => (r.y < y1 && r.y + r.height > y1) || (r.y < y2 && r.y + r.height > y2))) return undefined;
  return `M${source.x + source.width},${y1} H${right} V${y2} H${target.x + target.width}`;
}
