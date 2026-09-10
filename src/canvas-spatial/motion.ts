export type MotionBox = { x: number; y: number; width: number; height: number; presentation: boolean };
export type MotionBoxes = Record<string, MotionBox>;
export type MotionPlan = {
  from: MotionBoxes;
  to: MotionBoxes;
  strategy: 'x-first' | 'y-first' | 'linear';
  resizeAt: 0 | 0.5 | 1;
  safe: boolean;
  note: string;
};

const copy = (boxes: MotionBoxes): MotionBoxes => Object.fromEntries(Object.entries(boxes).map(([id, box]) => [id, { ...box }]));
const EPSILON = 0.001;

function midpoint(from: MotionBoxes, to: MotionBoxes, strategy: 'x-first' | 'y-first'): MotionBoxes {
  return Object.fromEntries(Object.entries(from).map(([id, box]) => [id, {
    ...box, x: strategy === 'x-first' ? to[id].x : box.x,
    y: strategy === 'y-first' ? to[id].y : box.y,
  }]));
}

// Each phase moves along one axis with a fixed measured size. Relative motion
// is linear, so its complete swept interval can be checked without sampling.
function phaseClear(start: MotionBoxes, end: MotionBoxes, sizes: MotionBoxes, ids: string[], axis: 'x' | 'y'): boolean {
  const cross = axis === 'x' ? 'y' : 'x';
  const length = axis === 'x' ? 'width' : 'height';
  const crossLength = axis === 'x' ? 'height' : 'width';
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i]; const b = ids[j];
      if (start[a][cross] + sizes[a][crossLength] <= start[b][cross] + EPSILON
        || start[b][cross] + sizes[b][crossLength] <= start[a][cross] + EPSILON) continue;
      const first = start[b][axis] - start[a][axis];
      const last = end[b][axis] - end[a][axis];
      if (Math.max(first, last) > -sizes[b][length] + EPSILON
        && Math.min(first, last) < sizes[a][length] - EPSILON) return false;
    }
  }
  return true;
}

function candidateClear(from: MotionBoxes, to: MotionBoxes, ids: string[], strategy: 'x-first' | 'y-first', resizeAt: MotionPlan['resizeAt']): boolean {
  const middle = midpoint(from, to, strategy);
  const firstSizes = resizeAt === 0 ? to : from;
  const lastSizes = resizeAt === 1 ? from : to;
  return phaseClear(from, from, from, ids, 'x') && phaseClear(to, to, to, ids, 'x')
    && phaseClear(from, middle, firstSizes, ids, strategy === 'x-first' ? 'x' : 'y')
    && phaseClear(middle, to, lastSizes, ids, strategy === 'x-first' ? 'y' : 'x');
}

/** A bounded transition policy, not another position solver. The caller passes
 * only selected durable IDs for collision checks; Work and unrelated history
 * must not influence the choreography. No candidate changes either endpoint.
 */
export function planMotion(fromInput: MotionBoxes, toInput: MotionBoxes, selectedDurableIds: string[]): MotionPlan {
  const to = copy(toInput);
  const from = Object.fromEntries(Object.keys(to).map(id => [id, { ...(fromInput[id] ?? to[id]) }]));
  const ids = [...new Set(selectedDurableIds)].filter(id => from[id] && to[id]);
  const xChanges = ids.some(id => Math.abs(from[id].x - to[id].x) > EPSILON);
  const yChanges = ids.some(id => Math.abs(from[id].y - to[id].y) > EPSILON);
  // Same-row WIDEN shrinks before horizontal travel and expands after return.
  // Normal column↔row comparison changes size/provenance at a clear midpoint.
  const candidates: [MotionPlan['strategy'], MotionPlan['resizeAt']][] = xChanges && !yChanges
    ? [['x-first', 0], ['x-first', 1], ['x-first', 0.5]]
    : yChanges && !xChanges ? [['y-first', 0], ['y-first', 1], ['y-first', 0.5]]
      : [['x-first', 0.5], ['y-first', 0.5], ['x-first', 0], ['y-first', 0], ['x-first', 1], ['y-first', 1]];
  for (const [strategy, resizeAt] of candidates) {
    if (strategy !== 'linear' && candidateClear(from, to, ids, strategy, resizeAt)) {
      return { from, to, strategy, resizeAt, safe: true,
        note: `${strategy}; measured size and provenance switch ${resizeAt === 0 ? 'before travel' : resizeAt === 1 ? 'after travel' : 'at the clear midpoint'}.` };
    }
  }
  return { from, to, strategy: 'linear', resizeAt: 0.5, safe: false,
    note: 'No clear two-phase transition exists for these selected boxes. Linear fallback may overlap during complex interruption or content-capacity cases.' };
}

/** Store this entire sampled result when a teacher interrupts: position, size
 * and provenance are one rendered snapshot. Resume plans from that snapshot.
 */
export function sampleMotion(plan: MotionPlan, progress: number): MotionBoxes {
  if (progress <= 0) return copy(plan.from);
  if (progress >= 1) return copy(plan.to);
  const sizes = progress >= plan.resizeAt ? plan.to : plan.from;
  const first = Math.min(1, progress * 2);
  const second = Math.max(0, progress * 2 - 1);
  const xProgress = plan.strategy === 'linear' ? progress : plan.strategy === 'x-first' ? first : second;
  const yProgress = plan.strategy === 'linear' ? progress : plan.strategy === 'y-first' ? first : second;
  return Object.fromEntries(Object.entries(plan.from).map(([id, box]) => [id, {
    ...sizes[id], x: box.x + (plan.to[id].x - box.x) * xProgress,
    y: box.y + (plan.to[id].y - box.y) * yProgress,
  }]));
}
