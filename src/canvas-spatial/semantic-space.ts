import { bounds, freePosition, overlaps, type Point, type Rect, type Size } from './geometry.ts';

export type SpaceMember = { id: string; group: string; size: Size };
export type SemanticSpace = { id: string; group: string; members: Record<string, Rect>; localBounds: Rect; placement: Point };
export type SemanticSpaces = { sessionId: string; spaces: SemanticSpace[] };
export const emptySpaces = (sessionId: string): SemanticSpaces => ({ sessionId, spaces: [] });
export const spaceBounds = (space: SemanticSpace): Rect => ({ ...space.localBounds,
  x: space.localBounds.x + space.placement.x, y: space.localBounds.y + space.placement.y });
export const SPACE_GAP = 48;
const LOCAL_GAP = 24;

/** Conservative explicit anchored membership. Local append preserves order;
 * growth pushes only subsequent intersecting local members. No Core→space 1:1
 * mapping, similarity inference, or authored global origins. */
export function updateSpaces(previous: SemanticSpaces, members: SpaceMember[]): SemanticSpaces {
  if (new Set(members.map(m => m.id)).size !== members.length) throw new Error('duplicate-space-member');
  for (const member of members) if (!member.group || !Number.isFinite(member.size.width) || !Number.isFinite(member.size.height)
    || member.size.width <= 0 || member.size.height <= 0) throw new Error('invalid-measurement');
  const spaces = structuredClone(previous.spaces);
  const known = new Map(spaces.flatMap(s => Object.keys(s.members).map(id => [id, s.group])));
  const changed: string[] = [];
  const active = new Set(members.map(m => m.id));
  for (const space of spaces) for (const id of Object.keys(space.members)) if (!active.has(id)) delete space.members[id];
  for (const member of members) {
    if (known.has(member.id) && known.get(member.id) !== member.group) throw new Error('space-membership-rebound');
    let space = spaces.find(s => s.group === member.group);
    if (!space) {
      const preferred = { x: spaces.length ? Math.max(...spaces.map(s => spaceBounds(s).x + spaceBounds(s).width)) + SPACE_GAP : 0, y: 0 };
      space = { id: `space:${member.group}`, group: member.group, members: {}, localBounds: { x: 0, y: 0, ...member.size },
        placement: freePosition(member.size, preferred, spaces.map(spaceBounds), SPACE_GAP) };
      spaces.push(space);
    }
    const old = Object.hasOwn(space.members, member.id) ? space.members[member.id] : undefined;
    Object.defineProperty(space.members, member.id, { enumerable: true, configurable: true, writable: true, value: { x: old?.x ?? 0, y: old?.y ?? (Object.keys(space.members).length
      ? Math.max(...Object.values(space.members).map(r => r.y + r.height)) + LOCAL_GAP : 0), ...member.size } });
  }
  for (const space of spaces) {
    const previousSpace = previous.spaces.find(s => s.id === space.id);
    const local = Object.values(space.members);
    for (let i = 1; i < local.length; i++) {
      for (let j = 0; j < i; j++) if (overlaps(local[j], local[i], LOCAL_GAP)) local[i].y = local[j].y + local[j].height + LOCAL_GAP;
    }
    space.localBounds = bounds(local) ?? { x: 0, y: 0, width: 0, height: 0 };
    if (!previousSpace || JSON.stringify(space.localBounds) !== JSON.stringify(previousSpace.localBounds)) changed.push(space.id);
  }
  const live = spaces.filter(s => Object.keys(s.members).length);
  // Local pressure wave. Each touched neighbor uses its nearest separating
  // axis translation; the sign follows existing geography. Previously settled
  // spaces are obstacles, so a wave terminates after at most N admissions.
  for (const rootId of changed) {
    const root = live.find(s => s.id === rootId);
    if (!root) continue;
    const queue = [root], settled = new Set<string>();
    while (queue.length) {
      const source = queue.shift()!;
      settled.add(source.id);
      for (const neighbor of live) {
        if (settled.has(neighbor.id) || !overlaps(spaceBounds(source), spaceBounds(neighbor), SPACE_GAP)) continue;
        const a = spaceBounds(source), b = spaceBounds(neighbor);
        const dx = b.x + b.width / 2 >= a.x + a.width / 2 ? a.x + a.width + SPACE_GAP - b.x : a.x - SPACE_GAP - b.width - b.x;
        const dy = b.y + b.height / 2 >= a.y + a.height / 2 ? a.y + a.height + SPACE_GAP - b.y : a.y - SPACE_GAP - b.height - b.y;
        const candidates = [{ x: b.x + dx, y: b.y }, { x: b.x, y: b.y + dy }]
          .sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y));
        const obstacles = live.filter(s => settled.has(s.id)).map(spaceBounds);
        const point = candidates.find(p => !obstacles.some(r => overlaps({ ...p, width: b.width, height: b.height }, r, SPACE_GAP)))
          ?? freePosition(b, b, obstacles, SPACE_GAP);
        neighbor.placement = { x: point.x - neighbor.localBounds.x, y: point.y - neighbor.localBounds.y };
        settled.add(neighbor.id);
        queue.push(neighbor);
      }
    }
  }
  // Defensive invariant; never publish a known overlapping persistent layout.
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    if (overlaps(spaceBounds(live[i]), spaceBounds(live[j]), SPACE_GAP - 0.001)) throw new Error('space-pressure-unresolved');
  }
  return { sessionId: previous.sessionId, spaces: live };
}
export function artifactHomes(state: SemanticSpaces): Record<string, Rect> {
  return Object.fromEntries(state.spaces.flatMap(space => Object.entries(space.members).map(([id, rect]) => [id,
    { ...rect, x: rect.x + space.placement.x, y: rect.y + space.placement.y }])));
}
