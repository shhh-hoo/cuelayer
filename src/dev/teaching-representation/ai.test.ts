import { expect, it } from 'vitest';
import { LESSON } from './lesson.ts';
import { IDS, goldPlans, produce, project, projectionErrors } from './producer.ts';
import { acceptAI, compareAI, currentAttention } from './ai.ts';

it('does not expose GOLD form choices to the AI request', () => {
  expect(JSON.stringify(currentAttention(LESSON[5]))).not.toContain('"kind":"PLOT"');
});
it('retains the last valid output after a malformed proposal, with explicit rejection', () => {
  const step = LESSON[4], previous = produce(step);
  const result = acceptAI(step, { checkpoint: step.id, raw: { html: '<svg />' }, elapsedMs: 1 }, previous, project(step, previous));
  expect(result.fallback).toBe(true); expect(result.errors).toContain('structured-output-invalid');
  expect(result.production.registry).toEqual(previous.registry);
});
it('prunes stale history before fallback, so invalid output cannot keep a withdrawn relation', () => {
  const previous = produce(LESSON[12]), step = LESSON[13];
  const result = acceptAI(step, { checkpoint: step.id, raw: null, elapsedMs: 1 }, previous, project(LESSON[12], previous));
  expect(result.fallback).toBe(true);
  expect(Object.values(result.production.registry).flatMap(p => p.relationRefs).some(r => r.id === step.refs.rateRelation.id)).toBe(false);
  expect(projectionErrors(step, result.production, result.projection)).toEqual([]);
});
it('does not allow an AI candidate to steal an existing identity for another target', () => {
  const step = LESSON[4], previous = produce(step);
  const result = acceptAI(step, { checkpoint: step.id, elapsedMs: 1, raw: { candidates: [{ candidateKind: 'PROPOSITION', candidateId: IDS.chain,
    semanticRefs: [step.refs.definition.id], relationRefs: [] }] } }, previous);
  expect(result.errors).toContain(`${IDS.chain}: candidate-identity-rebound`);
});
it('keeps raw proposals and reports form misses, unnecessary output, churn, latency, and fallback separately', () => {
  const rows = LESSON.map(step => ({ checkpoint: step.id, raw: { candidates: goldPlans(step) }, elapsedMs: 100 }));
  const before = JSON.stringify(rows); rows[5].raw = { candidates: [] };
  const result = compareAI(rows, LESSON);
  expect(result[5].metrics.missedVisualOpportunities).toBe(1);
  expect(result[5].metrics.fallback).toBe(true);
  expect(result[5].metrics.latencyMs).toBe(100);
  expect(result[4].metrics.unnecessaryRepresentations).toBeGreaterThan(0);
  expect(JSON.stringify(rows)).not.toBe(before);
  const after = JSON.stringify(rows); compareAI(rows, LESSON); expect(JSON.stringify(rows)).toBe(after);
});
