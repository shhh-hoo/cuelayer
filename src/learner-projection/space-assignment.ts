import type { SemanticReference } from '../lesson-stream/core/contracts.ts';
import type { AcceptedTeachingState, RepresentationProposal } from '../teaching-representation/contracts.ts';
import { validReference } from '../teaching-representation/grounding.ts';

/** Alpha conservatively uses the accepted target as a neighborhood anchor.
 * Different media for that target share a neighborhood; distinct accepted units
 * (including relations) do not merge based on proximity or shared Core alone.
 * Connected-component grouping would drift when topology changes; it is deferred.
 * This singleton fallback deliberately leaves broader pedagogical grouping open. */
export function assignSpace(state: AcceptedTeachingState, target: SemanticReference): RepresentationProposal['space'] {
  if (target.kind === 'CORE' || !validReference(state, target)) throw new Error('space-target-invalid');
  return { anchor: structuredClone(target), key: 'accepted-target-v1' };
}
