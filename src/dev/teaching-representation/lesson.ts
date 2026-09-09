import type { CompactEvidenceCheckpoint } from '../../lesson-stream/contracts.ts';
import type { CoreStep, CoreTeachingState, KnowledgeOperation, Provenance, SemanticReference } from '../../lesson-stream/core/contracts.ts';
import { coreEntityId } from '../../lesson-stream/core/events.ts';
import { createCoreTeachingState, reduceCoreStep } from '../../lesson-stream/core/teaching-state.ts';
import type { RecentSemanticChange } from '../../learner-projection/contracts.ts';

export type LessonStep = {
  id: string; title: string; time: string; speech: string; state: CoreTeachingState;
  checkpoints: CompactEvidenceCheckpoint[]; acceptedStep: CoreStep; recentChanges: RecentSemanticChange[];
  refs: Record<string, SemanticReference>; intent: 'HOME' | 'PLOT' | 'PAIR' | 'EQUATION' | 'RATE' | 'WIDEN' | 'COMPARE' | 'TANGENT';
};
export const WORDS = {
  catalyst: 'Catalyst', definition: 'A catalyst increases reaction rate and is regenerated overall.',
  pathway: 'Alternative reaction pathway', lower: 'Lower activation energy', fraction: 'Greater fraction of particles can overcome the barrier', rate: 'Faster reaction',
  arrhenius: 'Arrhenius', equation: 'k = A e^(−Eₐ/RT)', consequence: 'For fixed A and temperature, lower Eₐ gives a larger k.',
  reactants: 'Reactants', products: 'Products', uncatalysed: 'Uncatalysed pathway', catalysed: 'Catalysed pathway',
  progress: 'Reaction progress', energy: 'Potential energy', ea: 'Activation energy, Eₐ',
  endpoints: 'Both pathways have the same reactant and product energies.',
  exothermic: 'In this example, products have lower potential energy than reactants.',
} as const;
export const RELATIONS = {
  provides: 'A catalyst provides an alternative reaction pathway.',
  lowers: 'The alternative pathway has lower activation energy.',
  fraction: 'At the same temperature, lower activation energy allows a greater fraction of particles to overcome the barrier.',
  rate: 'A greater fraction overcoming the barrier leads to a faster reaction.',
  barrier: 'The catalysed pathway has a lower activation-energy barrier than the uncatalysed pathway.',
} as const;

/** Authored, synthetic, eight-minute lesson. Only this fixture accepts semantics;
 * presentation code receives immutable reducer snapshots and cannot write them.
 * Every entity uses the existing reducer's lesson-scoped identity convention.
 */
function buildLesson(): LessonStep[] {
  let state = createCoreTeachingState('teaching-representation:catalyst-v1');
  const refs: Record<string, SemanticReference> = {};
  const checkpoints: CompactEvidenceCheckpoint[] = [];
  const result: LessonStep[] = [];
  const add = (id: string, title: string, time: string, speech: string, intent: LessonStep['intent'],
    author: (api: { core: (key: string) => void; object: (core: string, key: keyof typeof WORDS) => void;
      relation: (core: string, key: keyof typeof RELATIONS, from: string, to: string) => void;
      refocus: (core: string) => void; invalidate: (key: string) => void }) => void) => {
    const checkpointId = `teaching:${id}`;
    const evidence = { checkpointId, quote: speech };
    const provenance: Provenance = { speechRefs: [evidence], stateRefs: [] };
    const step: CoreStep = { requestId: checkpointId, stepIndex: 0, baseKnowledgeRevision: state.knowledge.revision,
      baseCueRevision: state.cue.revision, consumesCheckpointIds: [checkpointId], knowledgeOps: [], cueDelta: { action: 'KEEP' },
      evidenceRefs: [evidence], stateRefs: [], warnings: [], acceptedAt: '2026-09-09T10:00:00.000Z' };
    const ops = step.knowledgeOps;
    const createId = (kind: 'CORE' | 'OBJECT' | 'RELATION') => coreEntityId(state.sessionId, step, kind, ops.length);
    const coreId = (key: string) => refs[key].id;
    const push = (operation: KnowledgeOperation) => { ops.push(operation); };
    author({
      core(key) { const id = createId('CORE'); refs[key] = { kind: 'CORE', id }; push({ action: 'CREATE_CORE', id, provenance }); },
      object(core, key) { const id = createId('OBJECT'); refs[key] = { kind: 'OBJECT', coreId: coreId(core), id };
        push({ action: 'ADD_OBJECT', coreId: coreId(core), id, value: { text: WORDS[key], provenance } }); },
      relation(core, key, from, to) { const id = createId('RELATION'); refs[`${key}Relation`] = { kind: 'RELATION', coreId: coreId(core), id };
        push({ action: 'ADD_RELATION', coreId: coreId(core), id, value: { text: RELATIONS[key], provenance,
          fromObjectId: refs[from].id, toObjectId: refs[to].id } }); },
      refocus(core) { push({ action: 'SET_CURRENT_CORE', coreId: coreId(core) }); },
      invalidate(key) { const ref = refs[key]; if (ref.kind !== 'RELATION') throw new Error('fixture-relation-required');
        push({ action: 'INVALIDATE', target: ref, correctionEvidence: evidence }); },
    });
    checkpoints.push({ checkpointId, lessonSequence: checkpoints.length + 1, speechRunId: 'authored-catalyst',
      startMs: checkpoints.length * 35_000, endMs: (checkpoints.length + 1) * 35_000, text: speech, sourceFinalIds: [], warnings: [] });
    state = reduceCoreStep(state, step, checkpoints);
    const recentChanges: RecentSemanticChange[] = ops.flatMap((op): RecentSemanticChange[] => {
      if (op.action === 'INVALIDATE') return [{ ref: op.target, kind: 'INVALIDATED' }];
      if (op.action === 'SET_CURRENT_CORE') return [{ ref: { kind: 'CORE', id: op.coreId }, kind: 'REFOCUSED' }];
      if (op.action === 'CREATE_CORE') return [{ ref: { kind: 'CORE', id: op.id }, kind: 'ADDED' }];
      if (op.action === 'ADD_OBJECT' || op.action === 'ADD_RELATION') return [{ ref: { kind: op.action === 'ADD_OBJECT' ? 'OBJECT' : 'RELATION', coreId: op.coreId, id: op.id }, kind: 'ADDED' }];
      return [];
    });
    result.push({ id, title, time, speech, intent, state, refs: structuredClone(refs), checkpoints: [...checkpoints], acceptedStep: step, recentChanges });
  };
  add('establish', 'Establish catalyst', '0:00', `${WORDS.catalyst}. ${WORDS.definition} Keep both parts of that definition in mind.`, 'HOME', a => {
    a.core('catalystCore'); a.object('catalystCore', 'catalyst'); a.object('catalystCore', 'definition'); a.refocus('catalystCore');
  });
  add('pathway', 'An alternative pathway', '0:40', `${RELATIONS.provides} ${WORDS.pathway}. We are starting to explain how the rate increases.`, 'HOME', a => {
    a.object('catalystCore', 'pathway'); a.relation('catalystCore', 'provides', 'definition', 'pathway');
  });
  add('lower', 'Two-node mechanism · no energy profile yet', '1:15', `${WORDS.lower}. ${RELATIONS.lowers} We have not yet established a comparison of two energy profiles.`, 'HOME', a => {
    a.object('catalystCore', 'lower'); a.relation('catalystCore', 'lowers', 'pathway', 'lower');
  });
  add('fraction', 'Extend the mechanism', '1:55', `${WORDS.fraction}. ${RELATIONS.fraction}`, 'HOME', a => {
    a.object('catalystCore', 'fraction'); a.relation('catalystCore', 'fraction', 'lower', 'fraction');
  });
  add('rate', 'The rate consequence', '2:35', `${WORDS.rate}. ${RELATIONS.rate} Trace that reasoning from the alternative pathway.`, 'HOME', a => {
    a.object('catalystCore', 'rate'); a.relation('catalystCore', 'rate', 'fraction', 'rate');
  });
  add('profile', 'Introduce a qualitative energy profile', '3:15', `${RELATIONS.barrier} ${WORDS.endpoints} ${WORDS.exothermic} The labels are ${WORDS.reactants}, ${WORDS.products}, ${WORDS.uncatalysed}, ${WORDS.catalysed}, ${WORDS.progress}, ${WORDS.energy}, and ${WORDS.ea}. No numerical values are supplied.`, 'PLOT', a => {
    for (const key of ['reactants', 'products', 'uncatalysed', 'catalysed', 'progress', 'energy', 'ea', 'endpoints', 'exothermic'] as const) a.object('catalystCore', key);
    a.relation('catalystCore', 'barrier', 'catalysed', 'uncatalysed');
  });
  add('pair', 'Connect chain and profile', '3:55', 'Keep the mechanism in view while using the energy profile as its companion.', 'PAIR', () => {});
  add('arrhenius', 'Shift to Arrhenius', '4:30', `${WORDS.arrhenius}. ${WORDS.equation}. Let us connect activation energy with the rate constant.`, 'EQUATION', a => {
    a.core('arrheniusCore'); a.object('arrheniusCore', 'arrhenius'); a.object('arrheniusCore', 'equation'); a.refocus('arrheniusCore');
  });
  add('arrhenius-rate', 'Lower Eₐ and larger k', '5:10', WORDS.consequence, 'RATE', a => a.object('arrheniusCore', 'consequence'));
  add('widen', 'Connect the two established ideas', '5:50', 'Bring the earlier lower-activation-energy idea alongside the Arrhenius consequence.', 'WIDEN', () => {});
  add('compare', 'Co-primary comparison', '6:20', 'Consider those two established statements together. Their juxtaposition does not establish a new relation.', 'COMPARE', () => {});
  add('return', 'Return to Catalyst and consolidate', '6:50', 'Return to the Catalyst explanation and trace its mechanism again.', 'PAIR', a => a.refocus('catalystCore'));
  add('tangent', 'Brief tangent · preserve', '7:20', 'The word catalyst also appears in everyday conversation. Anyway, back to our explanation.', 'TANGENT', () => {});
  add('invalidate', 'Withdraw an explanatory link', '7:45', 'Correction: withdraw the link from greater fraction overcoming the barrier to faster reaction in this explanation. Do not display that connection while we revisit the assumptions.', 'PAIR', a => a.invalidate('rateRelation'));
  return result;
}
export const LESSON = buildLesson();
