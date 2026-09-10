import { describe, expect, it } from 'vitest';
import { planMotion, sampleMotion, type MotionBox, type MotionBoxes, type MotionPlan } from './motion';

const box = (x: number, y: number, width: number, height: number, presentation = false): MotionBox => ({ x, y, width, height, presentation });
const mathHome = { base: box(0, 117, 780, 40), transformed: box(0, 205, 780, 80), equivalent: box(0, 333, 780, 80) };
const mathCompare = { base: box(0, 117, 392, 108, true), transformed: box(424, 117, 392, 188, true), equivalent: box(848, 117, 392, 148, true) };
const historyHome = { proclamation: box(0, 117, 780, 80), interpretationA: box(0, 245, 780, 80), interpretationB: box(0, 373, 780, 80) };
const historyCompare = { proclamation: box(0, 117, 392, 188, true), interpretationA: box(424, 117, 392, 188, true), interpretationB: box(848, 117, 392, 188, true) };
const widenHome = { catalyst: box(0, 333, 780, 40), arrhenius: box(1020, 333, 780, 80) };
const widen = { catalyst: box(488, 333, 500, 108, true), arrhenius: box(1020, 333, 500, 148, true) };

function assertNoOverlap(boxes: MotionBoxes, ids = Object.keys(boxes)): void {
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = boxes[ids[i]]; const b = boxes[ids[j]];
      const overlap = a.x < b.x + b.width - 0.001 && a.x + a.width > b.x + 0.001
        && a.y < b.y + b.height - 0.001 && a.y + a.height > b.y + 0.001;
      expect(overlap, `${ids[i]} and ${ids[j]}`).toBe(false);
    }
  }
}

function assertClearTrajectory(plan: MotionPlan): void {
  expect(plan.safe, plan.note).toBe(true);
  for (let progress = 0; progress <= 100; progress += 1) assertNoOverlap(sampleMotion(plan, progress / 100));
}

describe('measured desktop teaching transitions', () => {
  it.each([
    ['Math', mathHome, mathCompare], ['History', historyHome, historyCompare],
  ] as const)('%s separates horizontally before changing text geometry and returns vertically first', (_name, home, comparison) => {
    const originalHome = JSON.stringify(home);
    const entering = planMotion(home, comparison, Object.keys(home));
    expect(entering.strategy).toBe('x-first');
    expect(entering.resizeAt).toBe(0.5);
    assertClearTrajectory(entering);
    const returning = planMotion(comparison, home, Object.keys(home));
    expect(returning.strategy).toBe('y-first');
    expect(returning.resizeAt).toBe(0.5);
    assertClearTrajectory(returning);
    expect(JSON.stringify(sampleMotion(returning, 1))).toBe(originalHome);
    expect(JSON.stringify(home)).toBe(originalHome);
  });

  it('shrinks WIDEN boxes before same-row travel and expands only after returning home', () => {
    const entering = planMotion(widenHome, widen, Object.keys(widen));
    expect(entering.resizeAt).toBe(0);
    assertClearTrajectory(entering);
    const returning = planMotion(widen, widenHome, Object.keys(widen));
    expect(returning.resizeAt).toBe(1);
    assertClearTrajectory(returning);
    expect(sampleMotion(returning, 0.99).catalyst.width).toBe(500);
    expect(sampleMotion(returning, 0.99).catalyst.presentation).toBe(true);
    expect(sampleMotion(returning, 1)).toEqual(widenHome);
  });

  it('preserves the interrupted width and provenance together and resumes from that snapshot', () => {
    const entering = planMotion(mathHome, mathCompare, Object.keys(mathHome));
    const paused = sampleMotion(entering, 0.3);
    const frozen = JSON.stringify(paused);
    expect(paused.transformed.width).toBe(780);
    expect(paused.transformed.presentation).toBe(false);
    assertNoOverlap(paused);
    const resumed = planMotion(paused, mathCompare, Object.keys(mathHome));
    expect(sampleMotion(resumed, 0)).toEqual(paused);
    assertClearTrajectory(resumed);
    expect(sampleMotion(resumed, 1)).toEqual(mathCompare);
    expect(JSON.stringify(paused)).toBe(frozen);
  });

  it('keeps late interruption safe while returning to wider home text', () => {
    const returning = planMotion(mathCompare, mathHome, Object.keys(mathHome));
    const paused = sampleMotion(returning, 0.7);
    expect(paused.transformed.width).toBe(780);
    expect(paused.transformed.presentation).toBe(false);
    assertClearTrajectory(planMotion(paused, mathHome, Object.keys(mathHome)));
  });

  it('does not let transient Work or unrelated home content determine the selected path', () => {
    const from = { ...mathHome, work: box(0, 0, 4000, 4000), history: box(0, 200, 800, 800) };
    const to = { ...mathCompare, work: from.work, history: from.history };
    const plan = planMotion(from, to, Object.keys(mathHome));
    expect(plan.safe).toBe(true);
    for (const progress of [0, 0.2, 0.5, 0.8, 1]) {
      const sampled = sampleMotion(plan, progress);
      assertNoOverlap(sampled, Object.keys(mathHome));
      expect(sampled.history).toEqual(from.history);
      expect(sampled.work).toEqual(from.work);
    }
  });

  it('reports an unsafe fallback for same-row swaps even when both endpoints are clear', () => {
    const from = { a: box(0, 0, 100, 100), b: box(200, 0, 100, 100) };
    const to = { a: box(200, 0, 100, 100), b: box(0, 0, 100, 100) };
    const plan = planMotion(from, to, ['a', 'b']);
    expect(plan.safe).toBe(false);
    expect(plan.strategy).toBe('linear');
    expect(plan.note).toContain('may overlap');
    expect(sampleMotion(plan, 1)).toEqual(to);
  });
});
