import handler from "../../api/teaching/interpretation.ts";
import { createTeachingInterpretationSchema, normalizeTeachingProposal, teachingProviderContract, teachingResponseRequest } from "../../server/teaching/provider-contract.ts";
import { ACTIVE_ALPHA_SEMANTIC_PROFILE } from "../../src/lesson-stream/semantic-profile.ts";
import { interpretationDeadlines } from "../../src/lesson-stream/runtime-policy.ts";
import { TeachingInterpreterError, type TeachingInterpreter, type TeachingInterpretationResponse } from "../../src/lesson-stream/planner.ts";
import { persistedAuditDigest } from "../../src/trace/audit.ts";
import type { TeachingInterpretationRequest } from "../../src/lesson-stream/contracts.ts";

export const productionModel = () => process.env.OPENAI_MODEL ?? "gpt-5.6-luna";
export function requestConfiguration() {
  const contract = teachingProviderContract();
  return { model: productionModel(), profile: ACTIVE_ALPHA_SEMANTIC_PROFILE, policyVersion: contract.policyVersion,
    profileDigest: persistedAuditDigest(ACTIVE_ALPHA_SEMANTIC_PROFILE), policyDigest: persistedAuditDigest(contract.systemPolicy),
    schemaDigest: persistedAuditDigest(contract.text.format), schema: contract.text.format, reasoning: contract.reasoning,
    maxOutputTokens: contract.max_output_tokens, deadlines: interpretationDeadlines(), sdkRetries: 0, diagnosticOverrides: [] };
}

/** In-process production API handler: same provider, schema, normalizer and server timer; no HTTP latency. */
export function configuredInterpreter(): TeachingInterpreter {
  return { async interpret(request, options) {
    let status = 0; let result: unknown;
    await handler({ method: "POST", body: request, signal: options?.signal }, {
      setHeader() {}, status(code) { status = code; return { json(body) { result = body; } }; },
    });
    const body = result as Omit<TeachingInterpretationResponse, "audit"> & { error?: string; audit?: import("../../src/lesson-stream/audit-contracts.ts").TeachingProviderAudit | import("../../src/lesson-stream/audit-contracts.ts").TeachingProviderFailureAudit };
    if (status !== 200 || !body?.proposal) throw new TeachingInterpreterError(body?.error ?? "teaching-provider-unavailable", body?.audit && "failureStage" in body.audit ? body.audit : undefined);
    return body as TeachingInterpretationResponse;
  } };
}

export type MockAttempt = { delayMs?: number; outcome?: "success" | "provider-failure" | "timeout" | "invalid" };
/** Mechanical echo, NOT a semantic oracle. It sees only the production request supplied now. */
export function mockInterpreter(plan: MockAttempt[] = [], defaultDelayMs = 25): TeachingInterpreter {
  let attempts = 0;
  return { async interpret(request, options) {
    const item = plan[attempts++] ?? {};
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(delay); clearTimeout(deadline); options?.signal?.removeEventListener("abort", abort); };
      const abort = () => { cleanup(); reject(new Error("teaching-request-aborted")); };
      const deadline = setTimeout(() => { cleanup(); reject(new Error("teaching-interpretation-timeout")); }, interpretationDeadlines().providerMs);
      const delay = setTimeout(() => { cleanup(); resolve(); }, item.outcome === "timeout" ? 2 ** 30 : item.delayMs ?? defaultDelayMs);
      if (options?.signal?.aborted) abort(); else options?.signal?.addEventListener("abort", abort, { once: true });
    });
    if (item.outcome === "provider-failure") throw new Error("teaching-provider-unavailable");
    const raw = mockWireOutput(request);
    if (item.outcome === "invalid") raw.baseBoardRevision += 1;
    const parsed = createTeachingInterpretationSchema(ACTIVE_ALPHA_SEMANTIC_PROFILE).parse(raw);
    return { proposal: normalizeTeachingProposal(parsed, request), mockRawStructuredOutput: raw };
  } };
}
export function mockWireOutput(request: TeachingInterpretationRequest) {
  const ids = request.newEvidence.map(c => c.checkpointId);
  return { requestId: request.requestId, baseBoardRevision: request.currentState.board.revision, baseCueRevision: request.currentState.cue.revision,
    steps: [{ consumesCheckpointIds: ids,
      boardDelta: { action: "SET_ACTIVE", continuity: "same_thread", retainPrevious: false, support: null, invalidatesBoardItemIds: null,
        contribution: { mode: "REPRESENT", content: { kind: "TEXT", text: request.newEvidence.map(c => c.text).join(" ") }, provenance: { basis: "SPEECH", speechRefs: ids.map(checkpointId => ({ checkpointId })), stateRefs: null } } },
      cueDelta: { action: "KEEP" }, evidenceRefs: [{ checkpointId: ids.at(-1)! }], warnings: null }], warnings: null };
}
export function safeRequestEnvelope(request: TeachingInterpretationRequest) {
  return { model: productionModel(), ...teachingResponseRequest(request) };
}
