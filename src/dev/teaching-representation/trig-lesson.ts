import type { CompactEvidenceCheckpoint } from '../../lesson-stream/contracts.ts';
import type { CoreStep, Provenance, SemanticReference } from '../../lesson-stream/core/contracts.ts';
import { coreEntityId } from '../../lesson-stream/core/events.ts';
import { createCoreTeachingState, reduceCoreStep } from '../../lesson-stream/core/teaching-state.ts';
import type { RecentSemanticChange } from '../../learner-projection/contracts.ts';
import type { LessonStep } from './lesson.ts';

export const TRIG_WORDS = {
  title: 'Sine transformations', base: 'y = sin x', baseLabel: 'Base · a = 1', a1: 'a = 1',
  domain: '0 ≤ x ≤ 2π', xAxis: 'x (radians)', yAxis: 'y',
  amplitudeFamily: 'y = a sin x', amplitudeRule: 'Amplitude = |a|', a2: 'a = 2',
  amplitude: 'y = 2 sin x', amplitudeLabel: 'Amplitude · a = 2',
  shiftFamily: 'y = sin x + c', shiftRule: 'Vertical shift = c', c1: 'c = 1',
  shift: 'y = sin x + 1', shiftLabel: 'Vertical shift · c = 1',
} as const;
export const TRIG_RELATIONS = {
  baseValue: ['base', 'a1', 'The base sine function has a = 1.'],
  amplitudeValue: ['amplitude', 'a2', 'For a = 2, y = a sin x is y = 2 sin x.'],
  amplitudeRuleLink: ['amplitudeFamily', 'amplitudeRule', 'In y = a sin x, |a| controls amplitude.'],
  amplitudeComparison: ['base', 'amplitude', 'At each x, y = 2 sin x has twice the y value of y = sin x.'],
  shiftValue: ['shift', 'c1', 'For c = 1, y = sin x + c is y = sin x + 1.'],
  shiftRuleLink: ['shiftFamily', 'shiftRule', 'In y = sin x + c, c is the vertical shift.'],
  shiftComparison: ['base', 'shift', 'At each x, y = sin x + 1 is one unit above y = sin x.'],
} as const;

/** Seven authored evidence checkpoints, accepted only by the existing Core reducer.
 * These string keys are fixture handles, not semantic kinds or renderer authority.
 */
function buildTrigLesson(): LessonStep[] {
  let state = createCoreTeachingState('teaching-representation:trig-v1');
  const refs: Record<string, SemanticReference> = {}, checkpoints: CompactEvidenceCheckpoint[] = [], result: LessonStep[] = [];
  const add = (id: string, title: string, intent: LessonStep['intent'], objects: (keyof typeof TRIG_WORDS)[], relations: (keyof typeof TRIG_RELATIONS)[] = []) => {
    const checkpointId = `trig:${id}`;
    const speech = [...objects.map(key => TRIG_WORDS[key]), ...relations.map(key => TRIG_RELATIONS[key][2])].join('. ') || title;
    const evidence = { checkpointId, quote: speech }, provenance: Provenance = { speechRefs: [evidence], stateRefs: [] };
    const acceptedStep: CoreStep = { requestId: checkpointId, stepIndex: 0, baseKnowledgeRevision: state.knowledge.revision,
      baseCueRevision: state.cue.revision, consumesCheckpointIds: [checkpointId], knowledgeOps: [], cueDelta: { action: 'KEEP' },
      evidenceRefs: [evidence], stateRefs: [], warnings: [], acceptedAt: '2026-09-09T12:00:00.000Z' };
    const ops = acceptedStep.knowledgeOps;
    const entityId = (kind: 'CORE' | 'OBJECT' | 'RELATION') => coreEntityId(state.sessionId, acceptedStep, kind, ops.length);
    if (!result.length) {
      const id = entityId('CORE'); refs.trigCore = { kind: 'CORE', id }; ops.push({ action: 'CREATE_CORE', id, provenance });
      ops.push({ action: 'SET_CURRENT_CORE', coreId: id });
    }
    const coreId = refs.trigCore.id;
    for (const key of objects) {
      const id = entityId('OBJECT'); refs[key] = { kind: 'OBJECT', coreId, id };
      ops.push({ action: 'ADD_OBJECT', coreId, id, value: { text: TRIG_WORDS[key], provenance } });
    }
    for (const key of relations) {
      const id = entityId('RELATION'), [from, to, text] = TRIG_RELATIONS[key]; refs[key] = { kind: 'RELATION', coreId, id };
      ops.push({ action: 'ADD_RELATION', coreId, id, value: { text, provenance, fromObjectId: refs[from].id, toObjectId: refs[to].id } });
    }
    checkpoints.push({ checkpointId, lessonSequence: result.length + 1, speechRunId: 'authored-trig', startMs: result.length * 30_000,
      endMs: (result.length + 1) * 30_000, text: speech, sourceFinalIds: [], warnings: [] });
    state = reduceCoreStep(state, acceptedStep, checkpoints);
    const recentChanges: RecentSemanticChange[] = [...objects, ...relations].map(key => ({ ref: refs[key], kind: 'ADDED' }));
    result.push({ id: `trig-${id}`, title, time: `${Math.floor(result.length / 2)}:${result.length % 2 ? '30' : '00'}`,
      intent, speech, state, refs: structuredClone(refs), checkpoints: [...checkpoints], acceptedStep, recentChanges });
  };
  add('base', 'Base sine function', 'EQUATION', ['title', 'base', 'baseLabel', 'a1'], ['baseValue']);
  add('graph', 'The base function on a graph', 'PAIR', ['domain', 'xAxis', 'yAxis']);
  add('amplitude', 'Amplitude: choose a = 2', 'PAIR', ['amplitudeFamily', 'amplitudeRule', 'a2', 'amplitude', 'amplitudeLabel'], ['amplitudeValue', 'amplitudeRuleLink']);
  add('curves', 'Add the amplitude curve', 'PAIR', [], ['amplitudeComparison']);
  add('compare', 'Compare the two functions', 'COMPARE', []);
  add('shift', 'Vertical shift: choose c = 1', 'PAIR', ['shiftFamily', 'shiftRule', 'c1', 'shift', 'shiftLabel'], ['shiftValue', 'shiftRuleLink', 'shiftComparison']);
  add('home', 'Return to the learned structure', 'HOME', []);
  return result;
}
export const TRIG_LESSON = buildTrigLesson();
