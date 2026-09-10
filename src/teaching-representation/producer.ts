import { z } from 'zod';
import { semanticReferenceSchema } from '../lesson-stream/core/contracts.ts';
import type { ValidationPhase } from './capability.ts';
import { immutableCopy, type AcceptedTeachingState, type GroundedPayload, type GroundingContext, type RepresentationProducer, type RepresentationProduction } from './contracts.ts';
import { groundReferences, sameReference, validReference } from './grounding.ts';
import type { CapabilityRegistry } from './registry.ts';

const identity = z.string().trim().min(1).max(512);
const proposalSchema = z.object({ candidateId: identity, artifactId: identity, payloadId: identity, capabilityId: identity,
  target: semanticReferenceSchema, space: z.object({ key: identity, anchor: semanticReferenceSchema }).strict(), data: z.unknown(),
}).strict();

export function validatePayload(payload: GroundedPayload, state: AcceptedTeachingState, grounding: GroundingContext,
  registry: CapabilityRegistry, phase: ValidationPhase): GroundedPayload {
  const capability = registry.resolve(payload.capabilityId);
  const validated = capability.validate(payload.data, state, phase);
  if (!validated.references.length || !validated.references.some(ref => sameReference(ref, payload.target))
    || !validReference(state, payload.space.anchor)) throw new Error('ungrounded-target-or-space-anchor');
  const evidenceCheckpointIds = groundReferences(state, grounding, validated.references);
  return { ...payload, data: validated.data, references: validated.references, evidenceCheckpointIds };
}

/** Atomic admission: malformed/duplicate/ungrounded proposals fail the whole
 * production closed. No producer callback receives writable accepted state. */
export function produceRepresentations(state: AcceptedTeachingState, grounding: GroundingContext,
  producer: RepresentationProducer, registry: CapabilityRegistry): RepresentationProduction {
  const empty = (): RepresentationProduction => ({ sessionId: state.sessionId, candidates: [], payloads: new Map(), diagnostics: [] });
  try {
    const snapshot = immutableCopy(state), context = immutableCopy(grounding);
    if (!producer.producerId.trim()) throw new Error('producer-id-required');
    const proposals = z.array(proposalSchema).max(128).parse(producer.propose(snapshot, context));
    const result = empty();
    const artifactIds = new Set<string>(), payloadIds = new Set<string>();
    for (const proposal of proposals) {
      if (result.payloads.has(proposal.candidateId) || artifactIds.has(proposal.artifactId) || payloadIds.has(proposal.payloadId)) throw new Error('duplicate-representation-identity');
      artifactIds.add(proposal.artifactId); payloadIds.add(proposal.payloadId);
      const payload = validatePayload({ ...proposal, producerId: producer.producerId, references: [], evidenceCheckpointIds: [] }, snapshot, context, registry, 'proposal');
      result.payloads.set(proposal.candidateId, payload);
      result.candidates.push({ candidateType: 'REPRESENTATION', id: proposal.candidateId,
        representationKind: registry.resolve(proposal.capabilityId).representationKind, target: structuredClone(proposal.target),
        evidenceCheckpointIds: [...payload.evidenceCheckpointIds], producer: { skillId: producer.producerId } });
    }
    return result;
  } catch (error) { return { ...empty(), diagnostics: [error instanceof Error ? error.message : String(error)] }; }
}
