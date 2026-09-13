import type { CoreAbortSource, CoreTiming, CoreRequestWeight, CoreQueuePressure } from "../lesson-stream/core/diagnostics.ts";
import type { CoreEvent, CoreStep } from "../lesson-stream/core/contracts.ts";
import type { InterpretationContext } from "../lesson-stream/core/interpretation-context.ts";
import type { CoreProposal } from "../lesson-stream/core/interpretation-proposal.ts";

export type CoreContextDiagnostics = {
  version: string; characters: number; estimatedTokens: number; contextDigest: string;
  includedCoreCount: number; candidateCoreCount: number; entityCount: number; evidenceCount: number;
  cuePresence: InterpretationContext["cue"]["presence"];
  optionalContextClipped: boolean; baseKnowledgeRevision: number; baseCueRevision: number;
};
export type CoreVerificationJob = {
  sessionId: string; coreRequestId: string; verificationRequestIndex: number;
  checkpointIds: string[]; query: string; claim: string; candidateEvidence: string;
};
export type CoreTracePayloads = {
  "core.http": CoreTiming;
  "core.endpoint": CoreTiming;
  "core.attempt_completed": { scheduledAt: string; completedAt: string; elapsedMs: number;
    outcome: "accepted" | "needs_context" | "failure"; abortSource?: CoreAbortSource; queue: CoreQueuePressure };
  "core.representation": { knowledgeRevision: number; cueRevision: number; processedThroughSequence: number;
    candidateIds: string[]; selectedIds: string[]; projection: import('../learner-projection/contracts.ts').LearnerProjection;
    changes: import('../teaching-representation/artifact-runtime.ts').ArtifactChange[];
    admission: Array<Pick<import('../teaching-representation/contracts.ts').GroundedPayload, 'candidateId' | 'artifactId' | 'payloadId' | 'producerId' | 'capabilityId' | 'references' | 'evidenceCheckpointIds' | 'space'>>;
    artifacts: Array<{ id: string; revision: number; visible: boolean; space: import('../teaching-representation/contracts.ts').GroundedPayload['space'] }>;
    diagnostics: string[] };
  "core.projector": { knowledgeRevision: number; cueRevision: number; status: 'rendered' | 'degraded'; reason?: string;
    evidence?: import('../canvas-spatial/Canvas.tsx').CanvasEvidence };
  "core.checkpoint_committed": { checkpointId: string; lessonSequence: number; eventId: string };
  "core.request": { scheduledAt?: string; queue?: CoreQueuePressure; requestId: string; checkpointIds: string[]; diagnostics: CoreContextDiagnostics;
    context: InterpretationContext; entities: Array<{ handle: string; target: import("../lesson-stream/core/contracts.ts").SemanticReference; capabilities: string[] }> };
  "core.context_blocked": { checkpointIds: string[]; reason: string; mandatoryClosureFailed: boolean };
  "core.provider_request": { startedAt?: string; weight?: CoreRequestWeight; identity: { contract: string; policy: string }; requestedModel: string; request: unknown; requestDigest: string };
  "core.provider_response": { startedAt?: string; completedAt?: string; outcome?: "success" | "failure"; abortSource?: CoreAbortSource; response?: unknown; responseDigest?: string; transportError?: string; elapsedMs: number; truncated?: boolean };
  "core.proposal_normalized": { proposal: CoreProposal; proposalDigest: string };
  "core.validation": { status: "accepted" | "needs_context" | "rejected"; reason?: string; knowledgeRevision: number; cueRevision: number; stepCount?: number };
  "core.accepted": { steps: CoreStep[]; events: CoreEvent[]; eventIds: string[]; eventsDigest: string };
  "core.published": { eventIds: string[]; knowledgeRevision: number; cueRevision: number; stateDigest: string;
    processedThroughSequence: number; origin: "core-authority"; compatibilityProjection: "none" };
  "core.request_failed": { reason: string; category: string; stage: "provider" | "normalization" | "validation" | "persistence"; pendingCount: number };
  "core.verification": CoreVerificationJob & { status: "enqueued" | "started" | "completed" | "failed" | "timeout" | "cancelled" | "dropped"; reason?: string };
  "core.verification_dropped": { verificationRequestIndex: number; reason: string };
  "core.finalization": { status: "draining" | "ended" | "incomplete"; pendingCount: number; reason?: string };
};
