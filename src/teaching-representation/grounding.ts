import type { SemanticReference } from '../lesson-stream/core/contracts.ts';
import type { AcceptedTeachingState, GroundingContext } from './contracts.ts';

export const referenceKey = (ref: SemanticReference) => JSON.stringify(ref.kind === 'CORE' || ref.kind === 'CUE'
  ? [ref.kind, ref.id] : [ref.kind, ref.coreId, ref.id]);
export const sameReference = (a: SemanticReference, b: SemanticReference) => referenceKey(a) === referenceKey(b);
export function unit(state: AcceptedTeachingState, ref: SemanticReference) {
  if (ref.kind === 'CORE' || ref.kind === 'CUE') return undefined;
  const core = state.knowledge.cores[ref.coreId];
  const collection = core?.[ref.kind === 'OBJECT' ? 'objects' : ref.kind === 'RELATION' ? 'relations' : 'supports'];
  const value = collection && Object.hasOwn(collection, ref.id) ? collection[ref.id] : undefined;
  return value?.status === 'valid' ? value : undefined;
}
export function validReference(state: AcceptedTeachingState, ref: SemanticReference): boolean {
  if (ref.kind === 'CORE') return Object.hasOwn(state.knowledge.cores, ref.id);
  if (ref.kind === 'CUE') return state.cue.active?.id === ref.id;
  return Boolean(unit(state, ref));
}
export const textOf = (state: AcceptedTeachingState, ref: SemanticReference) => unit(state, ref)?.value.text ?? '';

/** Accepted state is factual authority. Check speech identities/quotes against
 * committed evidence; state/domain/correction provenance is already accepted,
 * and is not relabelled as teacher speech. Core containers cannot ground facts. */
export function groundReferences(state: AcceptedTeachingState, context: GroundingContext, refs: SemanticReference[]): string[] {
  const evidence = new Set<string>();
  const visiting = new Set<string>();
  const visit = (ref: SemanticReference): void => {
    const key = referenceKey(ref);
    if (visiting.has(key)) return;
    visiting.add(key);
    const fact = unit(state, ref);
    const provenance = fact?.value.provenance ?? (ref.kind === 'CUE' && state.cue.active?.id === ref.id ? state.cue.active.provenance : undefined);
    if (!provenance) throw new Error(`invalid-factual-reference:${key}`);
    const speech = [...provenance.speechRefs, ...(provenance.aiCorrection ? [provenance.aiCorrection.trigger] : [])];
    for (const source of speech) {
      const checkpoint = context.checkpoints.find(c => c.checkpointId === source.checkpointId && c.lessonSequence <= state.processedThroughSequence);
      if (!source.quote?.trim() || !checkpoint?.text.includes(source.quote)) throw new Error(`uncommitted-grounding:${source.checkpointId}`);
      evidence.add(source.checkpointId);
    }
    for (const source of provenance.stateRefs) visit(source.target);
  };
  refs.forEach(visit);
  // The unchanged M4A candidate contract requires committed evidence identities.
  // Pure domain-only forms need a separately reviewed adapter before admission.
  if (!evidence.size) throw new Error('candidate-needs-committed-evidence');
  return [...evidence].sort();
}
