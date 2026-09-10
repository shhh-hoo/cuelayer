import type { SemanticReference } from '../lesson-stream/core/contracts.ts';
import type { AcceptedTeachingState, RepresentationCandidate } from '../teaching-representation/contracts.ts';
import { referenceKey, validReference } from '../teaching-representation/grounding.ts';
import type { LearnerProjection } from './contracts.ts';
import { selectRepresentations } from './select-representations.ts';

export type AttentionPlan = Omit<LearnerProjection, 'attention'> & { attention: Omit<LearnerProjection['attention'], 'representations'> & {
  /** A completed M4A selection is executed verbatim, including an empty list. */
  representations?: LearnerProjection['attention']['representations'];
} };

/** Minimal deterministic host fallback: keep a valid current target, or use the
 * most recent accepted changed unit. Candidate availability never selects it.
 * An explicit reviewed M4A plan passes through unchanged, including framing. */
export function defaultAttention(state: AcceptedTeachingState, recent: SemanticReference[], previous?: LearnerProjection): AttentionPlan {
  const current = state.knowledge.currentCoreId;
  const eligible = (ref: SemanticReference) => ref.kind !== 'CORE' && ref.kind !== 'CUE' && ref.coreId === current && validReference(state, ref);
  const changed = recent.filter(eligible).at(-1);
  const old = previous?.attention.emphasis.find(eligible);
  const first = Object.keys(state.knowledge.cores[current ?? '']?.objects ?? {}).sort()
    .map(id => ({ kind: 'OBJECT' as const, coreId: current!, id })).find(eligible);
  const target = changed ?? old ?? first;
  const same = target && previous?.attention.emphasis.some(ref => referenceKey(ref) === referenceKey(target));
  return { attention: { anchor: target, emphasis: target ? [target] : [], context: [], support: [],
    ...(state.cue.active ? { cue: { cueId: state.cue.active.id, role: target ? 'companion' : 'dominant' } as const } : {}) },
    transition: { knowledge: recent.length ? 'ADVANCE' : 'PRESERVE', framing: 'FOCUS', representation: 'KEEP' },
    projector: same ? 'FOLLOW_ATTENTION' : 'REFRAME_ATTENTION',
    parkedCoreIds: Object.keys(state.knowledge.cores).filter(id => id !== current).sort() };
}

export function attentionRequests(plan: AttentionPlan) {
  if (plan.attention.representations) return plan.attention.representations.flatMap(r => r.target ? [{ target: r.target, kind: r.kind, role: r.role }] : []);
  return [...plan.attention.emphasis.map(target => ({ target, kind: 'TEXT' as const, role: 'dominant' as const })),
    ...[...plan.attention.context, ...plan.attention.support].map(target => ({ target, kind: 'TEXT' as const, role: 'companion' as const })),
    ...(plan.attention.cue ? [{ target: { kind: 'CUE' as const, id: plan.attention.cue.cueId }, kind: 'TEXT' as const, role: plan.attention.cue.role }] : [])];
}
export function projectProduction(plan: AttentionPlan, candidates: RepresentationCandidate[], previous?: LearnerProjection): LearnerProjection {
  return { ...plan, attention: { ...plan.attention, representations: plan.attention.representations ?? selectRepresentations(candidates, attentionRequests(plan), previous) } };
}
