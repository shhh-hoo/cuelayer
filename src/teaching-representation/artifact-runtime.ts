import type { LearnerProjection } from '../learner-projection/contracts.ts';
import { immutableCopy, type AcceptedTeachingState, type GroundedPayload, type GroundingContext, type RepresentationProduction } from './contracts.ts';
import { referenceKey, sameReference, unit } from './grounding.ts';
import { validatePayload } from './producer.ts';
import type { CapabilityRegistry } from './registry.ts';

export type Artifact = {
  id: string;
  payload: GroundedPayload;
  revision: number;
  fingerprint: string;
  visible: boolean;
  role?: 'dominant' | 'companion';
};
export type ArtifactRuntime = { sessionId: string; artifacts: Map<string, Artifact> };
export type ArtifactChange = { id: string; action: 'CREATE' | 'UPDATE' | 'PRESERVE' | 'WITHDRAW' };
export const emptyArtifactRuntime = (sessionId: string): ArtifactRuntime => ({ sessionId, artifacts: new Map() });
const binding = (p: GroundedPayload) => JSON.stringify([p.candidateId, p.artifactId, p.payloadId, p.capabilityId, p.producerId, referenceKey(p.target), p.space.key, referenceKey(p.space.anchor)]);

/** Reconcile against accepted truth on EVERY call, even PRESERVE/inspection.
 * Retained visual history only permits reuse; current M4A selection alone makes
 * an artifact visible. There is deliberately no event/replay or semantic writer. */
export function reconcileArtifacts(previous: ArtifactRuntime, state: AcceptedTeachingState, grounding: GroundingContext,
  production: RepresentationProduction, projection: LearnerProjection, registry: CapabilityRegistry): {
    runtime: ArtifactRuntime; changes: ArtifactChange[]; diagnostics: string[];
  } {
  const runtime = emptyArtifactRuntime(state.sessionId), changes: ArtifactChange[] = [], diagnostics: string[] = [];
  const snapshot = immutableCopy(state), context = immutableCopy(grounding);
  const prior = previous.sessionId === state.sessionId ? previous.artifacts : new Map<string, Artifact>();
  const current = production.sessionId === state.sessionId && !production.diagnostics.length ? production : undefined;
  const byCandidate = new Map([...prior.values()].map(a => [a.payload.candidateId, a]));
  const selected = new Map(projection.attention.representations.map(intent => [intent.id, intent]));
  const ids = new Set([...byCandidate.keys(), ...selected.keys()]);
  for (const candidateId of ids) {
    const old = byCandidate.get(candidateId), intent = selected.get(candidateId);
    const offered = current?.payloads.get(candidateId);
    const source = offered ?? old?.payload;
    if (!source || (!old && !intent)) continue;
    try {
      if (source.candidateId !== candidateId || (old && binding(old.payload) !== binding(source))) throw new Error('artifact-binding-changed');
      if (!old && [...prior.values()].some(a => a.id === source.artifactId || a.payload.payloadId === source.payloadId)) throw new Error('artifact-identity-rebound');
      const payload = validatePayload(structuredClone(source), snapshot, context, registry, offered ? 'proposal' : 'reuse');
      const capability = registry.resolve(payload.capabilityId);
      if (offered) {
        const candidate = current!.candidates.find(c => c.id === candidateId);
        if (!candidate || candidate.representationKind !== capability.representationKind || !candidate.target
          || !sameReference(candidate.target, payload.target) || candidate.producer?.skillId !== payload.producerId
          || JSON.stringify(candidate.evidenceCheckpointIds) !== JSON.stringify(payload.evidenceCheckpointIds)) throw new Error('candidate-payload-mismatch');
      }
      const visible = Boolean(intent && intent.kind === capability.representationKind && intent.target && sameReference(intent.target, payload.target));
      if (intent && !visible) throw new Error('selection-payload-mismatch');
      const fingerprint = JSON.stringify([payload.data, payload.references.map(ref => [ref, unit(snapshot, ref)?.value])]);
      if (runtime.artifacts.has(payload.artifactId)) throw new Error('duplicate-artifact');
      const changed = old?.fingerprint !== fingerprint;
      runtime.artifacts.set(payload.artifactId, { id: payload.artifactId, payload,
        revision: old ? old.revision + Number(changed) : 1, fingerprint, visible, role: visible ? intent!.role : undefined });
      changes.push({ id: payload.artifactId, action: !old ? 'CREATE' : old.visible && !visible ? 'WITHDRAW' : changed ? 'UPDATE' : 'PRESERVE' });
    } catch (error) {
      diagnostics.push(`${candidateId}: ${error instanceof Error ? error.message : String(error)}`);
      if (old) changes.push({ id: old.id, action: 'WITHDRAW' });
    }
  }
  return { runtime, changes, diagnostics };
}
