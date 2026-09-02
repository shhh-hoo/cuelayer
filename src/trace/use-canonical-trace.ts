import { useEffect, useRef } from "react";
import type { CanonicalSpeechState } from "../session/speech-types";
import { traceDraft, type TraceEmitter } from "./contracts";

export function canonicalRootId(runId: number, spanId: string, revision?: number) {
  return `speech:${runId}:span:${spanId}${revision === undefined ? "" : `@${revision}`}`;
}

export function useCanonicalTrace(runId: number, canonical: CanonicalSpeechState, emit: TraceEmitter) {
  const observedRunId = useRef<number | undefined>(undefined);
  const finalIds = useRef(new Set<string>());
  const spanRevisions = useRef(new Map<string, number>());

  useEffect(() => {
    if (observedRunId.current !== runId) {
      observedRunId.current = runId;
      finalIds.current = new Set();
      spanRevisions.current = new Map();
    }

    for (const final of canonical.finals) {
      if (finalIds.current.has(final.id)) continue;
      finalIds.current.add(final.id);
      emit(traceDraft("canonical.final_committed", {
        runId,
        finalId: final.id,
        transcript: final.text,
        wordCount: final.words.length,
      }, {
        priority: "critical",
        correlation: {
          rootId: `speech:${runId}:final:${final.id}`,
          runId,
          finalId: final.id,
        },
      }));
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
  }, [canonical.finals, canonical.spans, emit, runId]);
}
