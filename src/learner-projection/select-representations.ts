import type { LearnerProjection, ProjectionCandidate, RepresentationKind } from './contracts.ts';
import type { SemanticReference } from '../lesson-stream/core/contracts.ts';

export type RepresentationRequest = { target: SemanticReference; kind: RepresentationKind; role: 'dominant' | 'companion' };
const key = (ref: SemanticReference) => JSON.stringify(ref.kind === 'CORE' || ref.kind === 'CUE' ? [ref.kind, ref.id] : [ref.kind, ref.coreId, ref.id]);
/** Small deterministic selection adapter for an explicit attention plan. It
 * consumes only M4A metadata, never payloads, capability code or lesson IDs.
 * Requests originate in the dev review fixture until a governor is reviewed. */
export function selectRepresentations(candidates: readonly ProjectionCandidate[], requests: readonly RepresentationRequest[],
  previous?: LearnerProjection): LearnerProjection['attention']['representations'] {
  const result: LearnerProjection['attention']['representations'] = [];
  for (const request of requests) {
    const matches = candidates.filter(c => c.candidateType === 'REPRESENTATION' && c.target
      && key(c.target) === key(request.target) && c.representationKind === request.kind);
    const old = previous?.attention.representations.find(r => matches.some(c => c.id === r.id));
    const candidate = matches.find(c => c.id === old?.id) ?? [...matches].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)[0];
    if (candidate?.candidateType === 'REPRESENTATION' && !result.some(r => r.id === candidate.id)) {
      result.push({ id: candidate.id, kind: candidate.representationKind, role: request.role, target: candidate.target });
    }
  }
  return result;
}
