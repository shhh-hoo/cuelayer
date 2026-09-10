import type { SemanticReference } from '../lesson-stream/core/contracts.ts';
import type { RepresentationKind } from '../learner-projection/contracts.ts';
import { referenceKey } from './grounding.ts';

/** Collision-free tuple encoding, versioned independently of semantic identity.
 * variant is a reviewed representation purpose, never content or display order.
 * The same tuple always binds the candidate, artifact and payload together. */
export function representationIdentity(input: { sessionId: string; producerId: string; capabilityId: string;
  kind: RepresentationKind; target: SemanticReference; variant: string }) {
  const dimensions = [input.sessionId, input.producerId, input.capabilityId, input.kind, referenceKey(input.target), input.variant];
  if (dimensions.some(value => !value.trim())) throw new Error('representation-identity-dimension-required');
  const key = JSON.stringify(['representation-v1', ...dimensions]);
  return { candidateId: `candidate:${key}`, artifactId: `artifact:${key}`, payloadId: `payload:${key}` };
}
