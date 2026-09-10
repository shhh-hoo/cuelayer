import type { LearnerProjection, RepresentationKind } from '../../learner-projection/contracts.ts';
import { selectRepresentations, type RepresentationRequest } from '../../learner-projection/select-representations.ts';
import { reduceCoreStep } from '../../lesson-stream/core/teaching-state.ts';
import type { SemanticReference } from '../../lesson-stream/core/contracts.ts';
import { produceRepresentations } from '../../teaching-representation/producer.ts';
import type { AcceptedTeachingState, RepresentationProducer, RepresentationProposal, RepresentationProduction } from '../../teaching-representation/contracts.ts';
import { referenceKey, unit } from '../../teaching-representation/grounding.ts';
import { CapabilityRegistry } from '../../teaching-representation/registry.ts';
import { textCapability, graphCapability } from '../../representation-capabilities/accepted.tsx';
import { energyProfileCapability, arrheniusCapability } from '../../representation-capabilities/chemistry.tsx';
import { sineEquationCapability, functionPlotCapability, type SineForm } from '../../representation-capabilities/mathematics.tsx';
import { LESSON, type LessonStep } from './lesson.ts';
import { TRIG_LESSON } from './trig-lesson.ts';

// This is the only domain composition root. Generic hosts receive this registry.
export const capabilities = new CapabilityRegistry().register(textCapability).register(graphCapability)
  .register(energyProfileCapability).register(arrheniusCapability).register(sineEquationCapability).register(functionPlotCapability);
const proposal = (capabilityId: string, target: SemanticReference, group: string, anchor: SemanticReference, data: unknown): RepresentationProposal => {
  const identity = `${capabilityId}:${target.id}`;
  return { candidateId: `candidate:${identity}`, artifactId: `artifact:${identity}`, payloadId: `payload:${identity}`,
    capabilityId, target, space: { key: group, anchor }, data };
};
const object = (step: LessonStep, key: string) => {
  const ref = step.refs[key];
  if (ref?.kind !== 'OBJECT') throw new Error(`fixture-object:${key}`);
  return { ...ref, kind: 'OBJECT' as const };
};
const relation = (step: LessonStep, key: string) => {
  const ref = step.refs[key];
  if (ref?.kind !== 'RELATION') throw new Error(`fixture-relation:${key}`);
  return { ...ref, kind: 'RELATION' as const };
};
function form(step: LessonStep, key: 'base' | 'amplitude' | 'shift'): SineForm {
  return { equation: object(step, key), expression: { family: 'SINE', amplitude: key === 'amplitude' ? 2 : 1, verticalShift: key === 'shift' ? 1 : 0 } as SineForm['expression'],
    label: object(step, `${key}Label`), parameter: object(step, key === 'base' ? 'a1' : key === 'amplitude' ? 'a2' : 'c1'),
    valueRelation: relation(step, `${key}Value`), ...(key === 'base' ? {} : { family: object(step, `${key}Family`), rule: object(step, `${key}Rule`), ruleRelation: relation(step, `${key}RuleLink`) }) };
}
/** Authored reference bindings are fixture inputs. Proposals derive availability
 * from the accepted snapshot supplied to the producer, never the checkpoint's
 * index or desired lesson outcome. No AI/semantic acceptance inside production. */
export function fixtureProducer(step: LessonStep, subject: 'chemistry' | 'math'): RepresentationProducer {
  return { producerId: `authored.${subject}`, propose(state: AcceptedTeachingState) {
    const available = (key: string) => step.refs[key] && Boolean(unit(state, step.refs[key]));
    const proposals: RepresentationProposal[] = [];
    const offer = (id: string, key: string, group: string, core: string, data: unknown) => proposals.push(proposal(id, object(step, key), group, step.refs[core], data));
    if (subject === 'chemistry') {
      for (const key of ['definition', 'lower', 'consequence']) if (available(key)) offer('accepted.text', key, key === 'consequence' ? 'explanation' : 'mechanism',
        key === 'consequence' ? 'arrheniusCore' : 'catalystCore', { reference: object(step, key) });
      if (available('pathway')) offer('accepted.relations', 'pathway', 'mechanism', 'catalystCore', {
        nodes: ['pathway', 'lower', 'fraction', 'rate'].filter(available).map(k => object(step, k)),
        relations: ['lowersRelation', 'fractionRelation', 'rateRelation'].filter(available).map(k => relation(step, k)),
      });
      const keys = ['reactants', 'products', 'uncatalysed', 'catalysed', 'progress', 'energy', 'ea', 'endpoints', 'exothermic'];
      if (keys.every(available) && available('barrierRelation')) offer('chemistry.energy-profile', 'catalysed', 'energy', 'catalystCore',
        { labels: Object.fromEntries(keys.map(k => [k, object(step, k)])), barrier: relation(step, 'barrierRelation') });
      if (available('equation')) offer('chemistry.arrhenius', 'equation', 'explanation', 'arrheniusCore', { equation: object(step, 'equation') });
    } else {
      for (const key of ['base', 'amplitude', 'shift'] as const) if (available(key)) offer('math.sine-equation', key, 'equations', 'trigCore', { form: form(step, key) });
      if (available('domain') && available('base')) {
        const forms: SineForm[] = [form(step, 'base')];
        for (const key of ['amplitude', 'shift'] as const) if (available(key) && available(`${key}Comparison`)) forms.push({ ...form(step, key), comparison: relation(step, `${key}Comparison`) });
        offer('math.function-plot', 'base', 'functions', 'trigCore', { domain: object(step, 'domain'), xAxis: object(step, 'xAxis'), yAxis: object(step, 'yAxis'), forms });
      }
    }
    return proposals;
  } };
}
export function produceFixture(step: LessonStep, subject: 'chemistry' | 'math') {
  return produceRepresentations(step.state, { checkpoints: step.checkpoints }, fixtureProducer(step, subject), capabilities);
}
/** Review-only attention adapter into unchanged M4A. Selection asks for semantic
 * targets/media/roles and never names a candidate/artifact or reads payloads. */
export function projectFixture(step: LessonStep, subject: 'chemistry' | 'math', production: RepresentationProduction, previous?: LearnerProjection): LearnerProjection {
  const requests: RepresentationRequest[] = [];
  const add = (key: string, kind: RepresentationKind, role: 'dominant' | 'companion' = 'dominant') => {
    if (step.refs[key]) requests.push({ target: step.refs[key], kind, role });
  };
  if (subject === 'math') {
    if (step.intent === 'COMPARE') { add('base', 'MATH'); add('amplitude', 'MATH'); }
    else add(step.refs.shift && step.intent !== 'HOME' ? 'shift' : step.refs.amplitude && step.intent !== 'HOME' ? 'amplitude' : 'base', 'MATH');
    add('base', 'PLOT', 'companion');
  } else {
    switch (step.intent) {
      case 'PLOT': add('catalysed', 'PLOT'); break;
      case 'PAIR': add('pathway', 'DIAGRAM'); add('catalysed', 'PLOT', 'companion'); break;
      case 'EQUATION': add('equation', 'MATH'); break;
      case 'RATE': add('consequence', 'TEXT'); add('equation', 'MATH', 'companion'); break;
      case 'WIDEN': add('consequence', 'TEXT'); add('lower', 'TEXT', 'companion'); break;
      case 'COMPARE': add('lower', 'TEXT'); add('consequence', 'TEXT'); break;
      case 'TANGENT':
        for (const r of previous?.attention.representations ?? []) if (r.target) requests.push({ target: r.target, kind: r.kind, role: r.role });
        break;
      default: add(step.refs.pathway ? 'pathway' : 'definition', step.refs.pathway ? 'DIAGRAM' : 'TEXT');
    }
  }
  const representations = selectRepresentations(production.candidates, requests, previous);
  const dominant = requests.filter(r => r.role === 'dominant');
  const anchor = dominant[0]?.target ?? previous?.attention.anchor;
  const framing = step.intent === 'COMPARE' || step.intent === 'WIDEN' ? step.intent : 'FOCUS';
  return { attention: { anchor, emphasis: framing === 'COMPARE' ? dominant.slice(1).map(r => r.target) : [],
    context: framing === 'WIDEN' ? requests.filter(r => r.role === 'companion').map(r => r.target) : [], support: [], representations },
    transition: { knowledge: step.recentChanges.length ? 'ADVANCE' : 'PRESERVE', framing,
      representation: JSON.stringify(previous?.attention.representations) === JSON.stringify(representations) ? 'KEEP' : representations.length > 1 ? 'PAIR' : 'SWITCH' },
    projector: step.intent === 'TANGENT' ? 'PRESERVE_VIEW' : 'REFRAME_ATTENTION',
    parkedCoreIds: Object.keys(step.state.knowledge.cores).filter(id => id !== step.state.knowledge.currentCoreId) };
}
export function spaceGroup(payload: RepresentationProposal) { return `${referenceKey(payload.space.anchor)}:${payload.space.key}`; }
export function withdrawalStep(source: LessonStep, key: string): LessonStep {
  const step = structuredClone(source), checkpointId = `${source.id}:withdraw:${key}`, quote = `Correction: withdraw ${key}.`;
  step.checkpoints.push({ ...step.checkpoints.at(-1)!, checkpointId, lessonSequence: step.checkpoints.length + 1, text: quote });
  const target = step.refs[key];
  if (!target || target.kind === 'CORE' || target.kind === 'CUE') throw new Error('withdraw-unit-required');
  step.acceptedStep = { ...step.acceptedStep, requestId: checkpointId, consumesCheckpointIds: [checkpointId], evidenceRefs: [{ checkpointId, quote }],
    baseKnowledgeRevision: step.state.knowledge.revision, baseCueRevision: step.state.cue.revision,
    knowledgeOps: [{ action: 'INVALIDATE', target, correctionEvidence: { checkpointId, quote } }] };
  step.state = reduceCoreStep(step.state, step.acceptedStep, step.checkpoints);
  return { ...step, id: checkpointId, title: 'Withdraw the amplitude comparison', speech: quote, recentChanges: [{ ref: target, kind: 'INVALIDATED' }] };
}
export const CHEMISTRY_STORY = LESSON;
export const MATH_STORY = [...TRIG_LESSON, withdrawalStep(TRIG_LESSON.at(-1)!, 'amplitudeComparison')];
