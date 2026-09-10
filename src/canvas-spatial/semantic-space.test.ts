import { describe, expect, it } from 'vitest';
import { artifactHomes, emptySpaces, spaceBounds, updateSpaces, SPACE_GAP, type SemanticSpaces } from './semantic-space.ts';
import { overlaps } from './geometry.ts';
import { composePresentation } from './presentation.ts';
import { planMotion, sampleMotion } from './motion.ts';
const member = (id: string, group: string, width = 100, height = 100) => ({ id, group, size: { width, height } });
const noOverlap = (state: SemanticSpaces) => state.spaces.every((a, i) => state.spaces.slice(i + 1).every(b => !overlaps(spaceBounds(a), spaceBounds(b), SPACE_GAP - 0.001)));

describe('bounded Semantic Space local continuity', () => {
  it('establishes, joins, and creates an independent space without a Core→space 1:1 rule', () => {
    const a = updateSpaces(emptySpaces('s'), [member('a', 'core:anchor:one')]);
    const b = updateSpaces(a, [member('a', 'core:anchor:one'), member('b', 'core:anchor:one')]);
    const c = updateSpaces(b, [member('a', 'core:anchor:one'), member('b', 'core:anchor:one'), member('c', 'core:anchor:two')]);
    expect(a.spaces).toHaveLength(1); expect(b.spaces).toHaveLength(1); expect(c.spaces).toHaveLength(2);
    expect(Object.keys(c.spaces[0].members)).toEqual(['a', 'b']); expect(noOverlap(c)).toBe(true);
  });
  it('growth minimally displaces the adjacent space and propagates only local pressure', () => {
    const initial = updateSpaces(emptySpaces('s'), [member('a', 'A'), member('b', 'B'), member('c', 'C'), member('d', 'D')]);
    initial.spaces[3].placement.x = 4000;
    const local = structuredClone(initial.spaces.map(s => s.members));
    const grown = updateSpaces(initial, [member('a', 'A', 140), member('b', 'B'), member('c', 'C'), member('d', 'D')]);
    expect(grown.spaces[0].placement).toEqual(initial.spaces[0].placement);
    expect(grown.spaces[1].placement.x - initial.spaces[1].placement.x).toBe(40);
    expect(grown.spaces[2].placement.x - initial.spaces[2].placement.x).toBe(40);
    expect(grown.spaces[3].placement).toEqual(initial.spaces[3].placement);
    expect(grown.spaces.slice(1).map(s => s.members)).toEqual(local.slice(1));
    expect(noOverlap(grown)).toBe(true);
    expect(updateSpaces(initial, [member('a', 'A', 140), member('b', 'B'), member('c', 'C'), member('d', 'D')])).toEqual(grown);
  });
  it('moves local members only when measured growth requires it; shrink does not globally compact', () => {
    const input = [member('a', 'A'), member('b', 'A'), member('c', 'B')];
    const initial = updateSpaces(emptySpaces('s'), input);
    const grown = updateSpaces(initial, [member('a', 'A', 100, 130), input[1], input[2]]);
    expect(grown.spaces[0].members.b.y - initial.spaces[0].members.b.y).toBe(30);
    expect(Object.keys(grown.spaces[0].members)).toEqual(['a', 'b']);
    const shrunk = updateSpaces(grown, input);
    expect(shrunk.spaces[0].members.b.y).toBe(grown.spaces[0].members.b.y);
    expect(shrunk.spaces[1].placement).toEqual(grown.spaces[1].placement);
  });
  it('rejects missing measurements and ambiguous membership rather than publishing broken geometry', () => {
    expect(() => updateSpaces(emptySpaces('s'), [member('a', 'A', NaN)])).toThrow();
    expect(() => updateSpaces(emptySpaces('s'), [member('a', 'A'), member('a', 'B')])).toThrow();
    const state = updateSpaces(emptySpaces('s'), [member('a', 'A')]);
    expect(() => updateSpaces(state, [member('a', 'B')])).toThrow();
  });
  it('is deterministic and overlap-free for repeatable sequential multi-space growth', () => {
    const run = () => {
      const sizes = Array.from({ length: 12 }, (_, i) => member(`${i}`, `${i}`, 80 + i * 7, 80 + i * 3));
      let state = updateSpaces(emptySpaces('s'), sizes);
      for (let i = 0; i < 36; i++) {
        sizes[i % sizes.length].size.width += 13;
        state = updateSpaces(state, sizes); expect(noOverlap(state)).toBe(true);
      }
      return state;
    };
    expect(run()).toEqual(run());
  });
  it('treats prototype-like artifact IDs as plain membership keys', () => {
    const first = updateSpaces(emptySpaces('s'), [member('a', 'A')]);
    const next = updateSpaces(first, [member('a', 'A'), member('__proto__', 'A'), member('constructor', 'A')]);
    expect(Object.keys(next.spaces[0].members)).toEqual(['a', '__proto__', 'constructor']);
    expect(Object.hasOwn(artifactHomes(next), '__proto__')).toBe(true);
    expect(updateSpaces(next, [member('a', 'A'), member('__proto__', 'A'), member('constructor', 'A')])).toEqual(next);
  });
  it('COMPARE/WIDEN use selected canonical artifacts and return to persistent space geography', () => {
    const spaces = updateSpaces(emptySpaces('s'), [member('a', 'A'), member('b', 'B')]);
    const homes = artifactHomes(spaces), saved = structuredClone(spaces);
    for (const framing of ['COMPARE', 'WIDEN'] as const) {
      const projection = { transition: { framing } } as Parameters<typeof composePresentation>[2];
      const frame = composePresentation(homes, ['a', 'b', 'a'], projection, { width: 1280, height: 720 });
      expect(Object.keys(frame.temporary)).toEqual(['a', 'b']); expect(spaces).toEqual(saved);
      expect(overlaps(frame.boxes.a, frame.boxes.b, 0)).toBe(false);
      const from = Object.fromEntries(Object.entries(homes).map(([id, rect]) => [id, { ...rect, presentation: false }]));
      const to = Object.fromEntries(Object.entries(frame.boxes).map(([id, rect]) => [id, { ...rect, presentation: true }]));
      const motion = planMotion(from, to, ['a', 'b']);
      expect(sampleMotion(motion, 1)).toEqual(to);
      const returned = composePresentation(homes, ['a', 'b'], { transition: { framing: 'FOCUS' } } as never, { width: 1280, height: 720 });
      expect(returned.temporary).toEqual({}); expect(returned.boxes).toEqual(homes);
    }
  });
});
