import type { CoreLessonStreamRuntime } from '../lesson-stream/core/runtime.ts';
import type { SemanticReference } from '../lesson-stream/core/contracts.ts';
import { CoreTrace } from '../lesson-stream/core/trace.ts';
import type { TraceEmitter } from '../trace/contracts.ts';
import { attentionRequests, defaultAttention, projectProduction, type AttentionPlan } from '../learner-projection/production.ts';
import { emptyArtifactRuntime, reconcileArtifacts } from '../teaching-representation/artifact-runtime.ts';
import { productionRegistry, produceSessionRepresentations } from './representation-composition.ts';
import type { LearnerProjection } from '../learner-projection/contracts.ts';

/** Read-only publication port: no acceptance, reducer, store or evidence writer. */
export type CoreProjectorSource = Pick<CoreLessonStreamRuntime, 'sessionId' | 'state' | 'replay' | 'subscribe'>;
export class CoreProjector {
  readonly registry = productionRegistry();
  readonly trace: CoreTrace;
  private artifacts;
  private previous?: LearnerProjection;
  private acceptedState?: CoreProjectorSource['state'];
  private plan?: AttentionPlan;
  private value: ReturnType<CoreProjector['compute']>;
  private listeners = new Set<() => void>();
  private disconnect?: () => void;
  constructor(readonly source: CoreProjectorSource, trace?: TraceEmitter, attention?: AttentionPlan) {
    this.plan = attention;
    this.trace = new CoreTrace(trace);
    this.artifacts = emptyArtifactRuntime(source.sessionId);
    this.value = this.compute();
  }
  private compute() {
    const state = this.source.state, grounding = { checkpoints: this.source.replay.checkpoints };
    const recent: SemanticReference[] = this.source.replay.events.flatMap(event => {
      if (event.type !== 'core.step_accepted' || event.step.baseKnowledgeRevision < (this.acceptedState?.knowledge.revision ?? 0)) return [];
      return event.step.knowledgeOps.flatMap(op => {
        if (op.action === 'ADD_OBJECT' || op.action === 'REVISE_OBJECT') return [{ kind: 'OBJECT' as const, coreId: op.coreId, id: op.id }];
        return [];
      });
    });
    const plan = this.plan ?? defaultAttention(state, recent, this.previous);
    const production = produceSessionRepresentations(state, grounding, attentionRequests(plan).map(r => r.target), this.registry);
    const projection = projectProduction(plan, production.candidates, this.previous);
    const reconciliation = reconcileArtifacts(this.artifacts, state, grounding, production, projection, this.registry);
    this.artifacts = reconciliation.runtime; this.previous = projection; this.acceptedState = state;
    return { state, production, projection, ...reconciliation };
  }
  getSnapshot = () => this.value;
  private publish = () => {
    this.value = this.compute();
    this.record();
    for (const listener of this.listeners) listener();
  };
  private record() {
    const { state, production, projection, changes, diagnostics, runtime } = this.value;
    this.trace.record('core.representation', () => ({ knowledgeRevision: state.knowledge.revision, cueRevision: state.cue.revision,
      processedThroughSequence: state.processedThroughSequence, candidateIds: production.candidates.map(c => c.id),
      selectedIds: projection.attention.representations.map(r => r.id), projection, changes,
      admission: [...production.payloads.values()].map(p => ({ candidateId: p.candidateId, artifactId: p.artifactId,
        payloadId: p.payloadId, producerId: p.producerId, capabilityId: p.capabilityId, references: p.references,
        evidenceCheckpointIds: p.evidenceCheckpointIds, space: p.space })),
      artifacts: [...runtime.artifacts.values()].map(a => ({ id: a.id, revision: a.revision, visible: a.visible, space: a.payload.space })),
      diagnostics: [...production.diagnostics, ...diagnostics] }));
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    this.disconnect ??= this.source.subscribe(this.publish);
    // Record initial replay CREATEs; refresh only if publication raced mounting.
    if (this.source.state !== this.acceptedState) this.publish(); else this.record();
    return () => { this.listeners.delete(listener); if (!this.listeners.size) { this.disconnect?.(); this.disconnect = undefined; } };
  };
  setAttention(plan?: AttentionPlan) { if (plan === this.plan) return; this.plan = plan; this.publish(); }
}
