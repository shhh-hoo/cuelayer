import type { SemanticReference } from '../lesson-stream/core/contracts.ts';
import type { AcceptedTeachingState, GroundingContext, RepresentationProducer } from '../teaching-representation/contracts.ts';
import { CapabilityRegistry } from '../teaching-representation/registry.ts';
import { representationIdentity } from '../teaching-representation/identity.ts';
import { referenceKey, validReference } from '../teaching-representation/grounding.ts';
import { produceRepresentations } from '../teaching-representation/producer.ts';
import { assignSpace } from '../learner-projection/space-assignment.ts';
import { acceptedTextCapability } from '../representation-capabilities/accepted-text.tsx';

export const productionRegistry = () => new CapabilityRegistry().register(acceptedTextCapability);
export const PRODUCTION_PRODUCER = 'accepted-content-v1';
export function productionProducer(targets: readonly SemanticReference[]): RepresentationProducer {
  return { producerId: PRODUCTION_PRODUCER, propose(state) {
    return targets.filter(target => target.kind !== 'CORE' && validReference(state, target)).map(target => ({
      ...representationIdentity({ sessionId: state.sessionId, producerId: PRODUCTION_PRODUCER,
        capabilityId: acceptedTextCapability.capabilityId, kind: 'TEXT', target, variant: 'literal' }),
      capabilityId: acceptedTextCapability.capabilityId, target, space: assignSpace(state, target), data: { reference: target },
    }));
  } };
}

/** Requested targets precede the bounded current-Core candidate pool. Historical
 * artifacts revalidate independently, so this budget never deletes knowledge. */
export function produceSessionRepresentations(state: AcceptedTeachingState, grounding: GroundingContext,
  requested: SemanticReference[], registry: CapabilityRegistry) {
  const core = state.knowledge.cores[state.knowledge.currentCoreId ?? ''];
  const available: SemanticReference[] = core ? [
    ...Object.keys(core.objects).sort().map(id => ({ kind: 'OBJECT' as const, coreId: core.id, id })),
    ...Object.keys(core.relations).sort().map(id => ({ kind: 'RELATION' as const, coreId: core.id, id })),
    ...Object.keys(core.supports).sort().map(id => ({ kind: 'SUPPORT' as const, coreId: core.id, id })),
  ] : [];
  const unique = [...new Map([...requested, ...available].filter(ref => validReference(state, ref)).map(ref => [referenceKey(ref), ref])).values()];
  return produceRepresentations(state, grounding, productionProducer(unique.slice(0, 128)), registry);
}
