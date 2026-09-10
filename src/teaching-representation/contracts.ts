import type { CoreTeachingState, SemanticReference } from '../lesson-stream/core/contracts.ts';
import type { CompactEvidenceCheckpoint } from '../lesson-stream/contracts.ts';
import type { ProjectionCandidate } from '../learner-projection/contracts.ts';

export type ReadonlyDeep<T> = T extends object ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> } : T;
export type AcceptedTeachingState = ReadonlyDeep<CoreTeachingState>;
export type GroundingContext = { readonly checkpoints: readonly ReadonlyDeep<CompactEvidenceCheckpoint>[] };
export type RepresentationCandidate = Extract<ProjectionCandidate, { candidateType: 'REPRESENTATION' }>;

/** Host-only correlation. A group is a UI hint anchored in accepted knowledge,
 * not a Core classification. One anchor may host several independent groups. */
export type RepresentationProposal = {
  candidateId: string;
  artifactId: string;
  payloadId: string;
  capabilityId: string;
  target: SemanticReference;
  space: { key: string; anchor: SemanticReference };
  data: unknown;
};
export type GroundedPayload = RepresentationProposal & {
  producerId: string;
  references: SemanticReference[];
  evidenceCheckpointIds: string[];
};
export type RepresentationProduction = {
  sessionId: string;
  candidates: RepresentationCandidate[];
  payloads: Map<string, GroundedPayload>;
  diagnostics: string[];
};
export type RepresentationProducer = {
  producerId: string;
  propose(state: AcceptedTeachingState, grounding: GroundingContext): readonly RepresentationProposal[];
};

/** Runtime freezes a detached snapshot: even an ill-behaved trusted producer
 * cannot mutate the caller's accepted Core/Cue or committed evidence. */
export function immutableCopy<T>(value: T): ReadonlyDeep<T> {
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return;
    Object.values(item).forEach(freeze);
    Object.freeze(item);
  };
  const copy = structuredClone(value);
  freeze(copy);
  return copy as ReadonlyDeep<T>;
}
