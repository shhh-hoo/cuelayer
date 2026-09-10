import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { learnerProjectionFixtureErrors } from '../learner-projection/contracts.ts';
import { selectRepresentations } from '../learner-projection/select-representations.ts';
import { createCoreTeachingState, reduceCoreStep } from '../lesson-stream/core/teaching-state.ts';
import { CHEMISTRY_STORY, MATH_STORY, capabilities, fixtureProducer, produceFixture, projectFixture, withdrawalStep } from '../dev/teaching-representation/fixtures.ts';
import { TRIG_LESSON } from '../dev/teaching-representation/trig-lesson.ts';
import { emptyArtifactRuntime, reconcileArtifacts } from './artifact-runtime.ts';
import { produceRepresentations } from './producer.ts';
import { CapabilityRegistry } from './registry.ts';
import { textCapability } from '../representation-capabilities/accepted.tsx';
import { sampleSine } from '../representation-capabilities/sine.ts';

const emptyProjection = { attention: { emphasis: [], context: [], support: [], representations: [] }, transition: { knowledge: 'PRESERVE', framing: 'FOCUS', representation: 'KEEP' }, projector: 'PRESERVE_VIEW', parkedCoreIds: [] } as const;
function sequence(story = MATH_STORY, subject: 'chemistry' | 'math' = 'math') {
  let runtime = emptyArtifactRuntime(story[0].state.sessionId);
  let previous: ReturnType<typeof projectFixture> | undefined;
  return story.map(step => {
    const production = produceFixture(step, subject), projection = projectFixture(step, subject, production, previous);
    const next = reconcileArtifacts(runtime, step.state, { checkpoints: step.checkpoints }, production, projection, capabilities);
    runtime = next.runtime; previous = projection;
    return { step, production, projection, ...next };
  });
}
const byCapability = (record: ReturnType<typeof sequence>[number], id: string) => [...record.runtime.artifacts.values()].find(a => a.payload.capabilityId === id)!;

describe('accepted Core → production → M4A → artifact lifecycle', () => {
  for (const [subject, story] of [['chemistry', CHEMISTRY_STORY], ['math', MATH_STORY]] as const) {
    it(`${subject}: replays the existing GOLD acceptance and validates unchanged M4A at every checkpoint`, () => {
      let state = createCoreTeachingState(story[0].state.sessionId);
      for (const record of sequence(story, subject)) {
        const { step, production, projection } = record;
        state = reduceCoreStep(state, step.acceptedStep, step.checkpoints);
        expect(state).toEqual(step.state);
        expect(production.diagnostics).toEqual([]); expect(record.diagnostics).toEqual([]);
        expect(learnerProjectionFixtureErrors({ id: step.id, source: { family: 'RSC', title: 'Authored GOLD', url: 'https://edu.rsc.org/' }, sequenceSummary: step.title,
          input: { state, recentChanges: step.recentChanges, candidates: production.candidates, committedEvidenceCheckpointIds: step.checkpoints.map(c => c.checkpointId),
            presentationMode: 'presentationless', viewport: { width: 1280, height: 720 } }, expected: projection, mustNot: [] })).toEqual([]);
        expect(new Set([...record.runtime.artifacts.values()].filter(a => a.visible).map(a => a.payload.candidateId)))
          .toEqual(new Set(projection.attention.representations.map(r => r.id)));
      }
    });
  }
  it('candidate availability creates no artifact or visibility without M4A selection', () => {
    const step = MATH_STORY[5], production = produceFixture(step, 'math');
    expect(production.candidates).toHaveLength(4);
    const result = reconcileArtifacts(emptyArtifactRuntime(step.state.sessionId), step.state, { checkpoints: step.checkpoints }, production,
      structuredClone(emptyProjection) as never, capabilities);
    expect(result.runtime.artifacts.size).toBe(0);
    for (const candidate of production.candidates) expect(Object.keys(candidate).sort()).toEqual(['candidateType', 'evidenceCheckpointIds', 'id', 'producer', 'representationKind', 'target']);
    expect(JSON.stringify(production.candidates)).not.toMatch(/forms|expression|geometry|html|svg|width|capabilityId/);
  });
  it('joins by stable candidate identity and never depends on authored candidate names or array ordering', () => {
    const step = MATH_STORY[4], production = produceFixture(step, 'math');
    const original = projectFixture(step, 'math', production);
    const renamed = production.candidates.map((c, i) => ({ ...c, id: `arbitrary-${i}` })).reverse();
    const requests = original.attention.representations.map(r => ({ target: r.target!, kind: r.kind, role: r.role }));
    expect(selectRepresentations(renamed, requests).map(r => r.target)).toEqual(original.attention.representations.map(r => r.target));
  });
  it('Math plot grows 1 → 2 → 3 then loses only the invalidated curve under one identity', () => {
    const records = sequence(), plots = records.map(r => byCapability(r, 'math.function-plot'));
    expect(plots.map(a => a ? (a.payload.data as { forms: unknown[] }).forms.length : 0)).toEqual([0, 1, 1, 2, 2, 3, 3, 2]);
    expect(new Set(plots.filter(Boolean).map(a => a.id)).size).toBe(1);
    expect(plots[3].revision).toBeGreaterThan(plots[2].revision);
    expect(plots[6].revision).toBe(plots[5].revision);
    expect(records[4].projection.attention.representations.filter(r => r.role === 'dominant')).toHaveLength(2);
    expect(records[4].projection.attention.representations.filter(r => r.kind === 'PLOT')).toHaveLength(1);
  });
  it('Chemistry relation withdrawal preserves all four graph nodes and unrelated accepted knowledge', () => {
    const records = sequence(CHEMISTRY_STORY, 'chemistry');
    const before = byCapability(records.at(-2)!, 'accepted.relations'), after = byCapability(records.at(-1)!, 'accepted.relations');
    expect(after.id).toBe(before.id);
    expect((after.payload.data as { nodes: unknown[] }).nodes).toEqual((before.payload.data as { nodes: unknown[] }).nodes);
    expect((after.payload.data as { relations: unknown[] }).relations).toHaveLength(2);
    expect((before.payload.data as { relations: unknown[] }).relations).toHaveLength(3);
    expect(records.at(-1)!.step.state.knowledge.cores).toEqual(CHEMISTRY_STORY.at(-1)!.state.knowledge.cores);
  });
  it('revalidates stale historical payloads even on PRESERVE with no fresh production', () => {
    const before = sequence().at(-2)!, step = MATH_STORY.at(-1)!;
    const empty = { ...before.production, candidates: [], payloads: new Map() };
    const next = reconcileArtifacts(before.runtime, step.state, { checkpoints: step.checkpoints }, empty,
      { ...before.projection, projector: 'PRESERVE_VIEW', transition: { ...before.projection.transition, knowledge: 'PRESERVE' } }, capabilities);
    const plot = [...next.runtime.artifacts.values()].find(a => a.payload.capabilityId === 'math.function-plot')!;
    expect((plot.payload.data as { forms: unknown[] }).forms).toHaveLength(2);
    expect(plot.id).toBe(byCapability(before, 'math.function-plot').id);
  });
  it('withdraws a stale target, and never reuses artifacts across sessions', () => {
    const before = sequence().at(-2)!, step = withdrawalStep(before.step, 'base');
    const next = reconcileArtifacts(before.runtime, step.state, { checkpoints: step.checkpoints }, { ...before.production, candidates: [], payloads: new Map() }, before.projection, capabilities);
    expect([...next.runtime.artifacts.values()].filter(a => a.visible)).toHaveLength(0);
    const reset = reconcileArtifacts(before.runtime, { ...step.state, sessionId: 'other' }, { checkpoints: step.checkpoints }, before.production, before.projection, capabilities);
    expect(reset.runtime.artifacts.size).toBe(0);
  });
  it('prunes superseded historical semantics without reviving them through a replacement', () => {
    const before = sequence().at(-2)!, step = withdrawalStep(before.step, 'amplitudeComparison');
    const target = step.refs.amplitudeComparison, replacement = step.refs.shiftComparison;
    if (target.kind === 'CORE' || target.kind === 'CUE' || replacement.kind === 'CORE' || replacement.kind === 'CUE') throw new Error();
    step.state = reduceCoreStep(before.step.state, { ...step.acceptedStep, knowledgeOps: [{ action: 'SUPERSEDE', target, replacement,
      correctionEvidence: step.acceptedStep.evidenceRefs[0] }] }, step.checkpoints);
    const result = reconcileArtifacts(before.runtime, step.state, { checkpoints: step.checkpoints },
      { ...before.production, candidates: [], payloads: new Map() }, before.projection, capabilities);
    const plot = [...result.runtime.artifacts.values()].find(a => a.payload.capabilityId === 'math.function-plot')!;
    expect((plot.payload.data as { forms: unknown[] }).forms).toHaveLength(2);
    expect(plot.id).toBe(byCapability(before, 'math.function-plot').id);
  });
  it('hides valid unselected history and preserves identity when reselected', () => {
    const records = sequence(CHEMISTRY_STORY, 'chemistry');
    const graph = byCapability(records[6], 'accepted.relations');
    expect(byCapability(records[7], 'accepted.relations').visible).toBe(false);
    expect(byCapability(records[11], 'accepted.relations')).toMatchObject({ id: graph.id, visible: true });
  });
  it('fails closed for malformed markup, duplicate identities, unknown capabilities and candidate/payload mismatches', () => {
    const step = MATH_STORY[1], base = fixtureProducer(step, 'math');
    for (const transform of [
      (p: ReturnType<typeof base.propose>) => [{ ...p[0], html: '<script />' }],
      (p: ReturnType<typeof base.propose>) => [...p, p[0]],
      (p: ReturnType<typeof base.propose>) => [{ ...p[0], capabilityId: 'unknown' }],
      (p: ReturnType<typeof base.propose>) => [{ ...p[0], data: { html: '<script />' } }],
    ]) {
      const result = produceRepresentations(step.state, { checkpoints: step.checkpoints }, { ...base, propose: (s, g) => transform(base.propose(s, g)) }, capabilities);
      expect(result.candidates).toEqual([]); expect(result.payloads.size).toBe(0); expect(result.diagnostics.length).toBeGreaterThan(0);
    }
    const production = produceFixture(step, 'math'), projection = projectFixture(step, 'math', production);
    production.candidates[0].target = step.refs.domain;
    const result = reconcileArtifacts(emptyArtifactRuntime(step.state.sessionId), step.state, { checkpoints: step.checkpoints }, production, projection, capabilities);
    expect(result.diagnostics.join()).toContain('candidate-payload-mismatch');
  });
  it('cannot hijack a continuing artifact by changing capability, target, producer or payload identity', () => {
    const before = sequence().at(-2)!;
    for (const patch of [{ capabilityId: 'accepted.text' }, { target: before.step.refs.amplitude }, { producerId: 'other' }, { payloadId: 'other' }]) {
      const production = produceFixture(before.step, 'math');
      const payload = [...production.payloads.values()].find(p => p.capabilityId === 'math.function-plot')!;
      Object.assign(payload, patch);
      const result = reconcileArtifacts(before.runtime, before.step.state, { checkpoints: before.step.checkpoints }, production, before.projection, capabilities);
      expect(result.diagnostics.join()).toContain('artifact-binding-changed');
      expect(result.runtime.artifacts.has(payload.artifactId)).toBe(false);
    }
  });
  it('rejects changed accepted equation/label/parameter/relationship meaning or missing committed evidence', () => {
    for (const key of ['base', 'a2', 'shiftLabel', 'amplitudeComparison']) {
      const step = structuredClone(MATH_STORY[5]), ref = step.refs[key];
      if (ref.kind === 'CORE' || ref.kind === 'CUE') throw new Error();
      const core = step.state.knowledge.cores[ref.coreId];
      (ref.kind === 'RELATION' ? core.relations : core.objects)[ref.id].value.text = 'unsupported';
      expect(produceFixture(step, 'math').candidates).toEqual([]);
    }
    const step = MATH_STORY[5];
    expect(produceFixture({ ...step, checkpoints: [] }, 'math').candidates).toEqual([]);
  });
  it('isolates mutation attempts from accepted Core/Cue and evidence', () => {
    const step = structuredClone(MATH_STORY[0]), before = JSON.stringify(step);
    const result = produceRepresentations(step.state, { checkpoints: step.checkpoints }, { producerId: 'bad', propose(state) {
      (state.knowledge as { revision: number }).revision = 999; return [];
    } }, capabilities);
    expect(result.diagnostics.length).toBe(1); expect(JSON.stringify(step)).toBe(before);
  });
  it('keeps a trusted implementation registry distinct from host payload storage', () => {
    const registry = new CapabilityRegistry().register(textCapability);
    expect(() => registry.register(textCapability)).toThrow(); expect(() => registry.resolve('missing')).toThrow();
  });
  it('retains the finite sine renderer grammar inside Math only', () => {
    for (const raw of ['Math.sin(x)', { family: 'SINE', amplitude: 3, verticalShift: 0 }, { family: 'SINE', amplitude: 1, verticalShift: 0, code: 'alert(1)' }]) expect(() => sampleSine(raw)).toThrow();
    expect(sampleSine({ family: 'SINE', amplitude: 2, verticalShift: 0 })[64].y).toBe(2);
  });
});

it('keeps generic Teaching Representation/Canvas imports and branches subject-agnostic', () => {
  for (const folder of ['../teaching-representation/', '../canvas-spatial/']) {
    for (const file of readdirSync(new URL(folder, import.meta.url)).filter(f => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'))) {
      const source = readFileSync(new URL(`${folder}${file}`, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/(?:from\s*|import\s*\()["'][^"']*(?:dev\/|representation-capabilities|catalyst|trig|chemistry|mathematics)/i);
      expect(source, file).not.toMatch(/ENERGY_PROFILE|ARRHENIUS|FUNCTION_2D|\bTRIG\b|subject\s*===|TeachingMove|dangerouslySetInnerHTML|new\s+Function\b|\beval\s*\(/);
    }
  }
});
it('pins the versioned Core runtime extension, unchanged M4A and exact seven Math GOLD checkpoints', () => {
  const digest = (file: string) => createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex');
  // Session foundation adds only optional, versioned liveProcessing to accepted steps. Semantic GOLD stays frozen.
  expect(digest('../lesson-stream/core/contracts.ts')).toBe('8ca98aa5e72ae6de79549c041bb6d4c478937a5ae11f59ab21b5140fd4f63f64');
  expect(digest('../learner-projection/contracts.ts')).toBe('0b647ca2fc811e089bf0d054ce74475bf21dd9633e0ddd62eda60f85c3a238b8');
  expect(MATH_STORY.slice(0, 7)).toEqual(TRIG_LESSON);
});
