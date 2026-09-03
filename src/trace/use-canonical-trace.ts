import { useEffect, useRef } from "react";
import type { CanonicalSpeechState } from "../session/speech-types";
import { traceDraft, type TraceEmitter } from "./contracts";

export function canonicalRootId(runId: number, spanId: string, revision?: number) {
  return `speech:${runId}:span:${spanId}${revision === undefined ? "" : `@${revision}`}`;
}

export function canonicalFinalTraceDraft(runId: number, final: CanonicalSpeechState["finals"][number]) {
  return traceDraft("canonical.final_committed", {
    runId,
    finalId: final.id,
    ...(final.speechEventId ? { speechEventId: final.speechEventId } : {}),
    transcript: final.text,
    wordCount: final.words.length,
  }, {
    priority: "critical",
    correlation: {
      rootId: `speech:${runId}:final:${final.id}`,
      runId,
      finalId: final.id,
      ...(final.speechEventId ? { speechEventId: final.speechEventId } : {}),
    },
  });
}

export function useCanonicalTrace(sessionId: string, runId: number, canonical: CanonicalSpeechState, emit: TraceEmitter) {
  const observedScope = useRef<string | undefined>(undefined);
  const finalIds = useRef(new Set<string>());
  const spanRevisions = useRef(new Map<string, number>());

  useEffect(() => {
    const scope = `${sessionId}:${runId}`;
    if (observedScope.current !== scope) {
      observedScope.current = scope;
      finalIds.current = new Set();
      spanRevisions.current = new Map();
    }

    for (const final of canonical.finals) {
      if (finalIds.current.has(final.id)) continue;
      finalIds.current.add(final.id);
      emit(canonicalFinalTraceDraft(runId, final));
    }

    for (const span of canonical.spans) {
      if (spanRevisions.current.get(span.id) === span.revision) continue;
      spanRevisions.current.set(span.id, span.revision);
      emit(traceDraft("canonical.span_changed", {
        runId,
        spanId: span.id,
        revision: span.revision,
        status: span.status,
        ...(span.closeReason ? { closeReason: span.closeReason } : {}),
        transcript: span.text,
        sourceFinalIds: span.sourceFinalIds,
      }, {
        priority: "critical",
        correlation: {
          rootId: canonicalRootId(runId, span.id, span.revision),
          runId,
          spanId: span.id,
          spanRevision: span.revision,
        },
      }));
    }
  }, [canonical.finals, canonical.spans, emit, runId, sessionId]);
}
