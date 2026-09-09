import type { SemanticReference } from '../../lesson-stream/core/contracts.ts';
import type { LearnerProjection } from '../../learner-projection/contracts.ts';
import type { LessonStep } from './lesson.ts';
import { textOf, unit, type Production, type TeachingPresentationPayload } from './producer.ts';
import { TRIG_RELATIONS, TRIG_WORDS } from './trig-lesson.ts';
import type { FunctionPlot, SineExpression } from './trig-payload.ts';

export const TRIG_IDS = { base: 'trig-base-equation', amplitude: 'trig-amplitude-equation', shift: 'trig-shift-equation', plot: 'trig-function-plot' };
const expressions: Record<'base' | 'amplitude' | 'shift', SineExpression> = {
  base: { family: 'SINE', amplitude: 1, verticalShift: 0 },
  amplitude: { family: 'SINE', amplitude: 2, verticalShift: 0 },
  shift: { family: 'SINE', amplitude: 1, verticalShift: 1 },
};
const dependencies = {
  base: { objects: ['base', 'a1', 'baseLabel'], relations: ['baseValue'] },
  amplitude: { objects: ['amplitude', 'a2', 'amplitudeLabel', 'amplitudeFamily', 'amplitudeRule'], relations: ['amplitudeValue', 'amplitudeRuleLink'] },
  shift: { objects: ['shift', 'c1', 'shiftLabel', 'shiftFamily', 'shiftRule'], relations: ['shiftValue', 'shiftRuleLink'] },
} satisfies Record<string, { objects: (keyof typeof TRIG_WORDS)[]; relations: (keyof typeof TRIG_RELATIONS)[] }>;

/** Independent GOLD fixture adapter into the same host registry/M4A seam. Exact
 * accepted meanings and endpoints gate the finite renderer capability. This does
 * not change the frozen Catalyst/AI plan validator or infer new semantic truth.
 */
export function produceTrig(step: LessonStep): Production {
  const production: Production = { registry: {}, candidates: [], errors: [], warnings: [] };
  const available = (key: string) => Boolean(unit(step.state, step.refs[key]));
  const ground = (id: string, objects: (keyof typeof TRIG_WORDS)[], relations: (keyof typeof TRIG_RELATIONS)[] = []) => {
    const semanticRefs = [...new Set(objects)].map(key => {
      const ref = step.refs[key];
      if (!ref || ref.kind !== 'OBJECT' || textOf(step.state, ref) !== TRIG_WORDS[key]) throw new Error(`unsupported-object:${key}`);
      return ref;
    });
    const relationRefs = [...new Set(relations)].map(key => {
      const ref = step.refs[key], relation = unit(step.state, ref), [from, to, text] = TRIG_RELATIONS[key];
      if (!ref || ref.kind !== 'RELATION' || !relation || relation.value.text !== text || !('fromObjectId' in relation.value) || !('toObjectId' in relation.value)
        || relation.value.fromObjectId !== step.refs[from]?.id || relation.value.toObjectId !== step.refs[to]?.id
        || !available(from) || !available(to)) throw new Error(`unsupported-relationship:${key}`);
      return ref;
    });
    const evidenceCheckpointIds = [...new Set([...semanticRefs, ...relationRefs].flatMap(ref => {
      const evidence = unit(step.state, ref)!.value.provenance.speechRefs;
      if (!evidence.length || evidence.some(e => !step.checkpoints.some(cp => cp.checkpointId === e.checkpointId && cp.text.includes(e.quote ?? '')))) throw new Error(`uncommitted-evidence:${ref.id}`);
      return evidence.map(e => e.checkpointId);
    }))];
    return { id, semanticRefs, relationRefs, evidenceCheckpointIds };
  };
  const offer = (payload: TeachingPresentationPayload) => {
    production.registry[payload.id] = payload;
    production.candidates.push({ candidateType: 'REPRESENTATION', id: payload.id, representationKind: payload.kind === 'EQUATION' ? 'MATH' : 'PLOT',
      target: payload.semanticRefs[0], evidenceCheckpointIds: payload.evidenceCheckpointIds, producer: { skillId: 'dev.teaching-representation.gold.trig' } });
  };
  try {
    for (const key of ['base', 'amplitude', 'shift'] as const) {
      if (!available(key)) continue;
      const dep = dependencies[key];
      offer({ ...ground(TRIG_IDS[key], dep.objects, dep.relations), kind: 'EQUATION', format: 'TRIG', equation: step.refs[key],
        expression: { ...expressions[key] }, label: step.refs[`${key}Label`], family: step.refs[`${key}Family`], rule: step.refs[`${key}Rule`] });
    }
    if (available('domain') && available('base')) {
      const keys: ('base' | 'amplitude' | 'shift')[] = ['base'];
      for (const key of ['amplitude', 'shift'] as const) if (available(key) && available(`${key}Comparison`)) keys.push(key);
      const comparisons = keys.filter((key): key is 'amplitude' | 'shift' => key !== 'base').map(key => `${key}Comparison` as const);
      const objects = [...keys.flatMap(key => dependencies[key].objects), 'domain', 'xAxis', 'yAxis'] as (keyof typeof TRIG_WORDS)[];
      const relations = [...keys.flatMap(key => dependencies[key].relations), ...comparisons];
      const functions: FunctionPlot['functions'] = keys.map(key => ({ expressionRef: step.refs[key], expression: { ...expressions[key] },
        parameterRefs: [step.refs[key === 'base' ? 'a1' : key === 'amplitude' ? 'a2' : 'c1']],
        relationshipRefs: dependencies[key].relations.map(r => step.refs[r]) }));
      offer({ ...ground(TRIG_IDS.plot, objects, relations), kind: 'PLOT', plotKind: 'FUNCTION_2D', functions,
        domain: step.refs.domain, xAxis: step.refs.xAxis, yAxis: step.refs.yAxis, comparisonRefs: comparisons.map(key => step.refs[key]) });
    }
  } catch (error) { return { registry: {}, candidates: [], errors: [String(error)], warnings: [] }; }
  return production;
}

/** Authored attention only. Two co-primary MATH intents plus one PLOT companion
 * use the unchanged M4A COMPARE contract. No visual fields enter that contract.
 */
export function projectTrig(step: LessonStep, production: Production, previous?: LearnerProjection): LearnerProjection {
  const compare = step.intent === 'COMPARE';
  const key = step.refs.shift && step.intent !== 'HOME' ? 'shift' : step.refs.amplitude && step.intent !== 'HOME' ? 'amplitude' : 'base';
  const ids = compare ? [TRIG_IDS.base, TRIG_IDS.amplitude, TRIG_IDS.plot] : [TRIG_IDS[key], TRIG_IDS.plot];
  const representations: LearnerProjection['attention']['representations'] = ids.flatMap((id, i) => {
    const candidate = production.candidates.find(c => c.id === id);
    return candidate?.candidateType === 'REPRESENTATION' ? [{ id, kind: candidate.representationKind,
      target: candidate.target, role: i === 0 || (compare && i === 1) ? 'dominant' as const : 'companion' as const }] : [];
  });
  const anchor: SemanticReference = compare ? step.refs.base : step.refs[key];
  return { attention: { anchor, emphasis: compare ? [step.refs.amplitude] : [], context: [], support: [], representations },
    transition: { knowledge: step.recentChanges.length ? 'ADVANCE' : 'PRESERVE', framing: compare ? 'COMPARE' : 'FOCUS',
      representation: JSON.stringify(previous?.attention.representations) === JSON.stringify(representations) ? 'KEEP' : representations.length > 1 ? 'PAIR' : 'SWITCH' },
    projector: 'REFRAME_ATTENTION', parkedCoreIds: [] };
}
