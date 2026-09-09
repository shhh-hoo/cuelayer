import { describe, expect, it } from 'vitest';
import { LESSON, RELATIONS } from './lesson.ts';
import { IDS, buildPayload, goldPlans, produce, project, projectionErrors, proseWarning, visibleCatalog } from './producer.ts';
import { reduceCoreStep } from '../../lesson-stream/core/teaching-state.ts';
import { emptyHomes } from '../m4b-choreography/model.ts';
import { canvasCatalog, establishHomes, presentationPositions } from './canvas-model.ts';

describe('authored Catalyst representation contract', () => {
  it('keeps offered but unselected artifacts invisible and semantic attention independent of candidate IDs', () => {
    const step = LESSON[5], all = produce(step);
    const projection = project(step, all);
    expect(Object.keys(visibleCatalog(step, all, projection).registry)).toEqual([IDS.plot]);
    const wrong = produce(step, { candidates: [{ candidateKind: 'PROPOSITION', candidateId: IDS.plot, semanticRefs: [step.refs.definition.id], relationRefs: [] }] });
    const wrongProjection = project(step, wrong);
    expect(wrongProjection.attention.anchor).toEqual(projection.attention.anchor);
    expect(wrongProjection.attention.representations).toEqual([]);
  });
  it('replays every accepted step and preserves Core under producing/projecting', () => {
    let previous: ReturnType<typeof project> | undefined;
    LESSON.forEach((step, i) => {
      if (i) expect(reduceCoreStep(LESSON[i - 1].state, step.acceptedStep, step.checkpoints)).toEqual(step.state);
      const before = JSON.stringify(step.state), production = produce(step), projection = project(step, production, previous);
      expect(production.errors).toEqual([]); expect(projectionErrors(step, production, projection)).toEqual([]);
      expect(JSON.stringify(step.state)).toBe(before); previous = projection;
    });
  });
  it('keeps one chain identity through one, two, three, four, and withdrawn-link nodes', () => {
    expect([1, 2, 3, 4, 13].map(i => produce(LESSON[i]).registry[IDS.chain].semanticRefs.length)).toEqual([1, 2, 3, 4, 3]);
  });
  it('does not add a diagram for a single proposition or an early energy mention', () => {
    expect(Object.values(produce(LESSON[0]).registry).map(p => p.kind)).toEqual(['PROPOSITION']);
    for (const step of LESSON.slice(0, 5)) expect(produce(step).registry[IDS.plot]).toBeUndefined();
    expect(produce(LESSON[5]).registry[IDS.plot].kind).toBe('PLOT');
  });
  it('rejects an energy profile without the full accepted comparison and endpoints', () => {
    const plot = goldPlans(LESSON[5]).find(p => p.candidateId === IDS.plot)!;
    expect(produce(LESSON[2], { candidates: [plot] }).errors.length).toBeGreaterThan(0);
    expect(produce(LESSON[5], { candidates: [{ ...plot, semanticRefs: plot.semanticRefs.slice(1) }] }).errors.length).toBeGreaterThan(0);
  });
  it('rejects reversed chains, stale relations and invented refs without partial repair', () => {
    const chain = goldPlans(LESSON[4]).find(p => p.candidateId === IDS.chain)!;
    for (const proposal of [{ ...chain, semanticRefs: [...chain.semanticRefs].reverse() }, { ...chain, relationRefs: ['invented'] }]) {
      const result = produce(LESSON[4], { candidates: [goldPlans(LESSON[4])[0], proposal] }, 'AI');
      expect(result.candidates).toEqual([]); expect(result.errors.length).toBeGreaterThan(0);
    }
    expect(produce(LESSON[13], { candidates: [chain] }).candidates).toEqual([]);
  });
  it('does not infer causality merely from directed endpoints', () => {
    const step = structuredClone(LESSON[2]), relation = step.refs.lowersRelation;
    if (relation.kind !== 'RELATION') throw new Error('fixture');
    step.state.knowledge.cores[relation.coreId].relations[relation.id].value.text = 'These two ideas are related.';
    const payload = buildPayload(step, goldPlans(step).find(p => p.candidateId === IDS.chain)!);
    expect(payload.kind === 'RELATION_CHAIN' && payload.links[0].connector).toBe('neutral');
  });
  it('rejects arbitrary markup, coordinates, factual text and numeric data in plans', () => {
    const base = { candidates: goldPlans(LESSON[2]) };
    for (const key of ['html', 'svg', 'css', 'coordinates', 'text', 'values']) {
      expect(produce(LESSON[2], { candidates: [{ ...base.candidates[0], [key]: '<script>42</script>' }] }).errors).toEqual(['structured-output-invalid']);
    }
  });
  it('requires exact accepted equation grammar and full immutable evidence identities', () => {
    const step = structuredClone(LESSON[7]);
    const equation = goldPlans(step).find(p => p.candidateId === IDS.equation)!;
    expect(produce(step, { candidates: [equation] }).errors).toEqual([]);
    step.checkpoints = [];
    expect(produce(step, { candidates: [equation] }).errors.length).toBeGreaterThan(0);
  });
  it('exercises KEEP SWITCH PAIR and tangent PRESERVE with unchanged payloads', () => {
    let previous: ReturnType<typeof project> | undefined;
    const projections = LESSON.map(step => { previous = project(step, produce(step), previous); return previous; });
    expect(new Set(projections.map(p => p.transition.representation))).toEqual(new Set(['KEEP', 'SWITCH', 'PAIR']));
    expect(projections[12].projector).toBe('PRESERVE_VIEW');
    expect(projections[12].attention).toEqual(projections[11].attention);
    expect(produce(LESSON[12]).registry).toEqual(produce(LESSON[11]).registry);
  });
  it('keeps comparison neutral and requires co-primary accepted attention', () => {
    const plan = goldPlans(LESSON[10]).find(p => p.candidateId === IDS.compare)!;
    expect(produce(LESSON[10], { candidates: [plan] }).errors).toEqual([]);
    expect(produce(LESSON[9], { candidates: [plan] }).candidates).toEqual([]);
  });
  it('uses accepted structure, not word count alone, for prose review warnings', () => {
    const step = structuredClone(LESSON[4]), ref = step.refs.definition;
    if (ref.kind !== 'OBJECT') throw new Error('fixture');
    step.state.knowledge.cores[ref.coreId].objects[ref.id].value.text = `${RELATIONS.lowers} ${RELATIONS.fraction} ${RELATIONS.rate}`;
    const payload = produce(step).registry[IDS.intro];
    expect(proseWarning(step.state, payload)[0]).toContain('TEACHING REPRESENTATION WARNING');
    step.state.knowledge.cores[ref.coreId].objects[ref.id].value.text = 'A long unrelated sentence '.repeat(30);
    expect(proseWarning(step.state, payload)).toEqual([]);
  });
  it('maintains one canonical rendered object and unchanged homes through WIDEN/COMPARE/return', async () => {
    let homes = emptyHomes(); let previous: ReturnType<typeof project> | undefined;
    for (const step of LESSON) {
      const production = produce(step), projection = project(step, production, previous); previous = projection;
      const catalog = canvasCatalog(step, production, projection);
      expect(new Set(catalog.items.map(i => i.id)).size).toBe(catalog.items.length);
      const sizes = Object.fromEntries(catalog.items.map(i => [i.id, { width: 500, height: 80 }]));
      const next = establishHomes(homes, catalog.items, sizes);
      for (const [id, point] of Object.entries(homes.positions)) expect(next.positions[id]).toEqual(point);
      const before = structuredClone(next);
      await presentationPositions(catalog.scene, next, sizes, 1280, 720);
      expect(next).toEqual(before); homes = next;
    }
  });
});
