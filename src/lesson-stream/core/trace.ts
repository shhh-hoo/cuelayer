import { persistedAuditDigest } from "../../trace/audit.ts";
import { sanitizeAuditValue, sanitizeTraceValue, type SessionTraceDraft, type TraceEmitter, type TraceCorrelation } from "../../trace/contracts.ts";
import type { CoreContextDiagnostics, CoreTracePayloads } from "../../trace/core-contracts.ts";
import type { CoreInterpretationBinding } from "./interpretation-context.ts";

/** Lazy payload construction and sanitization are inside the diagnostic failure boundary. */
export class CoreTrace {
  constructor(private emit?: TraceEmitter) {}
  record<T extends keyof CoreTracePayloads>(type: T, payload: () => CoreTracePayloads[T], correlation?: TraceCorrelation) {
    if (!this.emit) return;
    try { this.emit({ type, payload: sanitizeAuditValue(payload()), correlation } as SessionTraceDraft<keyof CoreTracePayloads>); }
    catch { /* Diagnostics never affect acceptance, scheduling or audio. */ }
  }
}
export function coreContextDiagnostics(binding: CoreInterpretationBinding): CoreContextDiagnostics {
  const { context, base } = binding;
  const characters = JSON.stringify(context).length;
  return {
    version: context.version, characters, estimatedTokens: Math.ceil(characters / 4), contextDigest: persistedAuditDigest(context),
    includedCoreCount: context.entities.filter(e => e.kind === "CORE").length, candidateCoreCount: context.candidates.length,
    entityCount: context.entities.length, evidenceCount: context.evidence.length, cuePresence: context.cue.presence,
    optionalContextClipped: context.knowledge.cores === "partial" || context.entities.some(e => e.contents === "partial")
      || context.evidence.length < base.checkpoints.length || context.cue.presence === "omitted",
    baseKnowledgeRevision: base.state.knowledge.revision, baseCueRevision: base.state.cue.revision,
  };
}

/** Only bounded provider facts enter Core trace, including rejected raw text. */
export function coreProviderResponseAudit(input: unknown) {
  if (!input || typeof input !== "object") return { response: sanitizeTraceValue(input), truncated: false };
  const raw = input as Record<string, unknown>;
  const output = typeof raw.output_text === "string" ? raw.output_text : undefined;
  const response = {
    output_text: output?.slice(0, 65_536),
    status: typeof raw.status === "string" ? raw.status.slice(0, 100) : undefined,
    model: typeof raw.model === "string" ? raw.model.slice(0, 200) : undefined,
    id: typeof raw.id === "string" ? raw.id.slice(0, 200) : undefined,
    requestId: typeof raw.requestId === "string" ? raw.requestId.slice(0, 200) : undefined,
    usage: sanitizeTraceValue(raw.usage),
  };
  return { response, truncated: (output?.length ?? 0) > 65_536 };
}
