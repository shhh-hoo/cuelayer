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
  "core.checkpoint_committed": { checkpointId: string; lessonSequence: number; eventId: string };
  "core.request": { requestId: string; checkpointIds: string[]; diagnostics: CoreContextDiagnostics;
    context: InterpretationContext; entities: Array<{ handle: string; target: import("../lesson-stream/core/contracts.ts").SemanticReference; capabilities: string[] }> };
  "core.context_blocked": { checkpointIds: string[]; reason: string; mandatoryClosureFailed: boolean };
  "core.provider_request": { identity: { contract: string; policy: string }; requestedModel: string; request: unknown; requestDigest: string };
  "core.provider_response": { response?: unknown; responseDigest?: string; transportError?: string; elapsedMs: number; truncated?: boolean };
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
