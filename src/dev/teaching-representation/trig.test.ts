// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createCoreTeachingState, reduceCoreStep } from '../../lesson-stream/core/teaching-state.ts';
import { TRIG_LESSON } from './trig-lesson.ts';
import { produceTrig, projectTrig, TRIG_IDS } from './trig-producer.ts';
import { sampleSine } from './trig-payload.ts';
import { FunctionPlot } from './TrigPrimitives.tsx';
import { LESSON } from './lesson.ts';
import { produce, project, projectionErrors, visibleCatalog, unit } from './producer.ts';
import { trigCanvasCatalog } from './trig-canvas.ts';
import { establishHomes, plotAttachment, presentationPositions } from './canvas-model.ts';
import { emptyHomes } from '../m4b-choreography/model.ts';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const read = (path: string) => readFileSync(new URL(path, import.meta.url));
describe('GOLD-only trigonometric holdout', () => {
  it('replays the independent seven-checkpoint fixture through unchanged Core and M4A', () => {
    let state = createCoreTeachingState('teaching-representation:trig-v1'), previous: ReturnType<typeof projectTrig> | undefined;
    expect(TRIG_LESSON).toHaveLength(7);
    for (const step of TRIG_LESSON) {
      state = reduceCoreStep(state, step.acceptedStep, step.checkpoints); expect(state).toEqual(step.state);
      const before = JSON.stringify(state), production = produceTrig(step), projection = projectTrig(step, production, previous);
      expect(production.errors).toEqual([]); expect(projectionErrors(step, production, projection)).toEqual([]);
      expect(JSON.stringify(state)).toBe(before); previous = projection;
    }
  });
  it('grounds every function, parameter, relationship and visible label in accepted evidence', () => {
    for (const step of TRIG_LESSON) for (const payload of Object.values(produceTrig(step).registry)) {
      for (const ref of [...payload.semanticRefs, ...payload.relationRefs]) expect(unit(step.state, ref)).toBeDefined();
      expect(payload.evidenceCheckpointIds.every(id => step.checkpoints.some(cp => cp.checkpointId === id))).toBe(true);
      if (payload.kind === 'PLOT' && payload.plotKind === 'FUNCTION_2D') {
        const refs = new Set([...payload.semanticRefs, ...payload.relationRefs].map(r => r.id));
        for (const ref of [payload.domain, payload.xAxis, payload.yAxis, ...payload.comparisonRefs,
          ...payload.functions.flatMap(f => [f.expressionRef, ...f.parameterRefs, ...f.relationshipRefs])]) expect(refs.has(ref.id)).toBe(true);
      }
      if (payload.kind === 'EQUATION' && payload.format === 'TRIG') for (const ref of [payload.equation, payload.label, payload.family, payload.rule].filter(Boolean)) {
        expect(payload.semanticRefs.some(r => r.id === ref!.id)).toBe(true);
      }
    }
  });
  it('keeps the same plot ID while accepted curve counts progress, and never graphs an unsupported comparison', () => {
    const plots = TRIG_LESSON.map(step => produceTrig(step).registry[TRIG_IDS.plot]);
    expect(plots.map(p => p?.kind === 'PLOT' && p.plotKind === 'FUNCTION_2D' ? p.functions.length : 0)).toEqual([0, 1, 1, 2, 2, 3, 3]);
    expect(new Set(plots.filter(Boolean).map(p => p.id))).toEqual(new Set([TRIG_IDS.plot]));
    expect(TRIG_LESSON.map(step => produceTrig(step).registry[TRIG_IDS.base].semanticRefs[0])).toEqual(Array(7).fill(TRIG_LESSON[0].refs.base));
  });
  it('produces identical payloads, samples and SVG from identical accepted inputs', () => {
    for (const step of TRIG_LESSON) expect(produceTrig(structuredClone(step))).toEqual(produceTrig(step));
    const step = TRIG_LESSON[6], payload = produceTrig(step).registry[TRIG_IDS.plot];
    if (payload.kind !== 'PLOT' || payload.plotKind !== 'FUNCTION_2D') throw new Error('plot expected');
    const html = renderToStaticMarkup(createElement(FunctionPlot, { state: step.state, payload }));
    expect(renderToStaticMarkup(createElement(FunctionPlot, { state: structuredClone(step.state), payload: structuredClone(payload) }))).toBe(html);
    const rendered = document.createElement('div'); rendered.innerHTML = html;
    expect([...rendered.querySelectorAll('[data-curve-ref]')].map(el => el.getAttribute('data-curve-ref'))).toEqual(payload.functions.map(f => f.expressionRef.id));
    const [base, amplitude, shift] = payload.functions.map(f => sampleSine(f.expression));
    for (let i = 0; i < base.length; i++) { expect(amplitude[i].y).toBe(base[i].y * 2); expect(shift[i].y).toBe(base[i].y + 1); }
    expect(base[64].y).toBe(1); expect(amplitude[64].y).toBe(2); expect(shift[192].y).toBe(0);
  });
  it('rejects executable expressions, extra properties and unsupported numeric forms', () => {
    for (const raw of ['Math.sin(x)', 'globalThis.alert(1)', { family: 'SINE', amplitude: 3, verticalShift: 0 },
      { family: 'SINE', amplitude: 2, verticalShift: 1 }, { family: 'SINE', amplitude: 1, verticalShift: 0, code: 'alert(1)' }]) expect(() => sampleSine(raw)).toThrow();
    for (const file of ['./trig-payload.ts', './trig-producer.ts', './TrigPrimitives.tsx']) {
      expect(read(file).toString()).not.toMatch(/\beval\s*\(|new\s+Function\b|dangerouslySetInnerHTML/);
    }
  });
  it('rejects altered equations, labels, parameter values, endpoints and uncommitted evidence', () => {
    for (const key of ['base', 'a2', 'amplitudeLabel', 'shiftRule']) {
      const step = structuredClone(TRIG_LESSON[6]), ref = step.refs[key];
      if (ref.kind !== 'OBJECT') throw new Error('object expected');
      step.state.knowledge.cores[ref.coreId].objects[ref.id].value.text = 'unsupported';
      expect(produceTrig(step).candidates).toEqual([]); expect(produceTrig(step).errors.length).toBeGreaterThan(0);
    }
    const reversed = structuredClone(TRIG_LESSON[4]), ref = reversed.refs.amplitudeComparison;
    if (ref.kind !== 'RELATION') throw new Error('relation expected');
    reversed.state.knowledge.cores[ref.coreId].relations[ref.id].value.toObjectId = reversed.refs.base.id;
    expect(produceTrig(reversed).candidates).toEqual([]);
    expect(produceTrig({ ...TRIG_LESSON[6], checkpoints: [] }).candidates).toEqual([]);
  });
  it('removes a curve when its accepted comparison is invalidated instead of reusing a cached plot', () => {
    const step = structuredClone(TRIG_LESSON[6]), ref = step.refs.amplitudeComparison;
    const checkpointId = 'trig:withdrawal-test', quote = 'I withdraw the amplitude comparison.';
    step.checkpoints.push({ ...step.checkpoints[6], checkpointId, lessonSequence: 8, text: quote });
    const correction = { ...step.acceptedStep, requestId: checkpointId, consumesCheckpointIds: [checkpointId], evidenceRefs: [{ checkpointId, quote }],
      knowledgeOps: [{ action: 'INVALIDATE' as const, target: ref, correctionEvidence: { checkpointId, quote } }],
      baseKnowledgeRevision: step.state.knowledge.revision, baseCueRevision: step.state.cue.revision };
    // Synthetic reducer-level adversarial test; no extra learner checkpoint.
    step.state = reduceCoreStep(step.state, correction, step.checkpoints);
    const plot = produceTrig(step).registry[TRIG_IDS.plot];
    expect(plot.id).toBe(TRIG_IDS.plot);
    expect(plot.kind === 'PLOT' && plot.plotKind === 'FUNCTION_2D' && plot.functions.map(f => f.expressionRef.id)).toEqual([step.refs.base.id, step.refs.shift.id]);
  });
  it('selects two grounded co-primary equations and a visible graph in COMPARE', () => {
    const step = TRIG_LESSON[4], production = produceTrig(step), projection = projectTrig(step, production);
    expect(projection.transition.framing).toBe('COMPARE');
    expect(projection.attention.representations.filter(r => r.role === 'dominant').map(r => r.target)).toEqual([step.refs.base, step.refs.amplitude]);
    const graph = projection.attention.representations.find(r => r.id === TRIG_IDS.plot);
    expect(graph).toMatchObject({ kind: 'PLOT', role: 'companion' });
    const catalog = trigCanvasCatalog(step, production, projection);
    expect(catalog.scene.required).toHaveLength(3); expect(catalog.scene.required).toContain(`presentation:${TRIG_IDS.plot}`);
    expect(catalog.links).toEqual([]); // Neutral proximity is renderer grammar, never a causal semantic arrow.
  });
  it('reuses measured choreography with one canonical node and immutable home coordinates', async () => {
    let homes = emptyHomes();
    for (const step of TRIG_LESSON) {
      const production = produceTrig(step), projection = projectTrig(step, production), catalog = trigCanvasCatalog(step, production, projection);
      expect(new Set(catalog.items.map(i => i.id)).size).toBe(catalog.items.length);
      const sizes = Object.fromEntries(catalog.items.map(item => [item.id, { width: projection.transition.framing === 'COMPARE' ? item.presentationWidth ?? item.width! : item.width!, height: item.kind === 'REPRESENTATION' ? 451 : 120 }]));
      const next = establishHomes(homes, catalog.items, sizes);
      for (const [id, point] of Object.entries(homes.positions)) expect(next.positions[id]).toEqual(point);
      const before = structuredClone(next), temporary = await presentationPositions(catalog.scene, next, sizes, 1280, 614);
      expect(next).toEqual(before);
      if (projection.transition.framing === 'COMPARE') expect(Object.keys(temporary.positions)).toHaveLength(3);
      if (step.intent === 'HOME') expect(temporary.positions).toEqual({});
      const plot = catalog.items.find(i => i.kind === 'REPRESENTATION');
      if (plot) expect(plotAttachment(next, plot)).toEqual({ x: 510, y: 105 });
      homes = next;
    }
  });
  it('preserves the exact starting Core/M4A contracts and full Catalyst GOLD sequence', () => {
    // Frozen at b549cf8 before the holdout. Deliberate later contract work needs review.
    expect(digest(read('../../lesson-stream/core/contracts.ts'))).toBe('ce5b8da41bd8a5e62de63fc696c7ff84287260ef9f4856ca13860abc6db20d89');
    expect(digest(read('../../learner-projection/contracts.ts'))).toBe('0b647ca2fc811e089bf0d054ce74475bf21dd9633e0ddd62eda60f85c3a238b8');
    let previous: ReturnType<typeof project> | undefined, history: ReturnType<typeof produce> | undefined;
    const records = LESSON.map(step => { const production = produce(step), projection = project(step, production, previous); previous = projection;
      history = visibleCatalog(step, production, projection, history); return { step, production, projection, visible: history }; });
    expect(digest(JSON.stringify(records))).toBe('b17d225b5918f889f30ebc535ac16fe7ed948a45770e13f72cf3f43e00108915');
  });
});
