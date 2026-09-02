import { applySpeechEvent, closeCanonicalSpeechSpan, createInitialCanonicalSpeechState, isPlannerCheckpoint } from "./canonical-speech";
import { compileCaptionEpisode } from "../planner/caption-compiler";
import { activateCaption, createInitialCaptionRuntime, expireCaption, expireLearnerCue, showLearnerCue, toggleCaptionLock } from "../planner/caption-runtime";
import { fallbackFromGroundedSpeech, validateRuntimeDecision } from "../planner/validation";
import { appendTeachingTraceEvents, createTeachingTraceState, elapsedMs, plannerInputSummary, spanRevisionTimestampFor, spanTraceIdFor, traceIdFor } from "./teaching-trace";
import type { SessionAction, SessionState } from "./session-types";
import type { TeachingTraceEventDraft } from "./teaching-trace";

function initialPlanner() {
  return { status: "idle" as const, requestId: 0, runtime: createInitialCaptionRuntime() };
}

export function createInitialSessionState(traceEnabled = false, traceForwardingLimit?: number): SessionState {
  return { status: "idle", presentation: { status: "empty", stream: null }, speech: { status: "off", canonical: createInitialCanonicalSpeechState(), debug: { runId: 0, providerEvents: 0, provisionalEvents: 0, committedEvents: 0 } }, planner: initialPlanner(), trace: createTeachingTraceState(traceEnabled, traceForwardingLimit) };
}

/** The browser-side trace is only a forwarding queue; durable storage owns retention. */
export function createDurableSessionState(): SessionState {
  // The durable event store, not React, owns session retention. This is only
  // a bounded hand-off window for the local trace store and live viewer.
  return createInitialSessionState(true, 500);
}

function withTrace(state: SessionState, events: TeachingTraceEventDraft[]): SessionState {
  const trace = appendTeachingTraceEvents(state.trace, events);
  return trace === state.trace ? state : { ...state, trace };
}

function actionSegmentIds(action: Extract<SessionAction, { type: "planner-decision" | "planner-failed" | "planner-aborted" }>) {
  if (action.segmentIds?.length) return action.segmentIds;
  return action.type === "planner-decision" ? [action.input.recentSpeech.at(-1)?.id].filter((id): id is string => Boolean(id)) : [];
}

function exactSpanRevision(state: SessionState, spanId: string, spanRevision: number) {
  const index = state.speech.canonical.spans.findIndex((span) => span.id === spanId && span.revision === spanRevision);
  return index >= 0 && !state.speech.canonical.spans.slice(index + 1).some(isPlannerCheckpoint);
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "restart":
      return createDurableSessionState();
    case "begin-capture":
      if (state.presentation.status === "starting" || state.presentation.status === "ready") return state;
      return { ...state, status: state.status === "paused" ? "paused" : "active", presentation: { status: "starting", stream: null } };
    case "capture-ready":
      if (state.presentation.status !== "starting" || state.status === "idle" || state.status === "ended") return state;
      return { ...state, presentation: { status: "ready", stream: action.stream } };
    case "capture-failed":
      if (state.status === "idle" || state.status === "ended") return state;
      return { ...state, presentation: { status: "error", stream: null, error: action.error } };
    case "capture-ended":
      if (state.status === "idle" || state.status === "ended") return state;
      return { ...state, presentation: { status: "ended", stream: null } };
    case "begin-speech":
      if (state.status === "ended" || state.status === "paused" || state.speech.status === "starting" || state.speech.status === "ready") return state;
      return {
        ...state,
        status: "active",
        speech: { status: "starting", canonical: createInitialCanonicalSpeechState(), debug: { runId: action.runId, providerEvents: 0, provisionalEvents: 0, committedEvents: 0 } },
        planner: initialPlanner(),
      };
    case "speech-ready":
      if (state.speech.debug.runId !== action.runId || state.speech.status !== "starting" || state.status !== "active") return state;
      return { ...state, speech: { ...state.speech, status: "ready" } };
    case "speech-event": {
      const now = action.now ?? 0;
      const finalId = `provider-final-${state.speech.canonical.finals.length}`;
      const providerSequence = action.event.kind === "error" ? state.speech.debug.providerEvents : action.event.provider?.sequence ?? state.speech.debug.providerEvents;
      const speechEventId = action.event.kind === "error" ? `provider-event-${action.runId}-${providerSequence}` : action.event.provider?.messageId ?? `provider-event-${action.runId}-${providerSequence}`;
      const traceId = traceIdFor(action.runId, speechEventId);
      const asrEvent: TeachingTraceEventDraft = action.event.kind === "error"
        ? { traceId, stage: "asr", timestamp: now, speechEventId, decision: "error", isFinal: false, reason: action.event.message, errorCode: action.event.code }
        : { traceId, stage: "asr", timestamp: now, speechEventId, finalId: action.event.kind === "committed" ? finalId : undefined, decision: action.event.kind === "committed" ? "final" : "partial", transcript: action.event.text, isFinal: action.event.kind === "committed", provider: { ...action.event.provider, sequence: providerSequence } };
      let nextState = withTrace(state, [asrEvent]);
      if (action.event.kind === "error") {
        if (state.speech.debug.runId !== action.runId || state.status === "idle" || state.status === "ended") return nextState;
        if (state.speech.status === "starting" || state.speech.status === "ready" || state.speech.status === "paused") return { ...nextState, speech: { ...state.speech, status: "error", error: { code: action.event.code, message: action.event.message }, debug: { ...state.speech.debug, lastError: { code: action.event.code, message: action.event.message } } } };
        return nextState;
      }
      const rejectionReason = state.speech.debug.runId !== action.runId
        ? "stale_speech_run"
        : state.status === "idle" || state.status === "ended"
          ? "session_not_active"
          : state.status !== "active"
            ? "session_paused"
            : state.speech.status !== "ready"
              ? "speech_not_ready"
              : undefined;
      if (rejectionReason) {
        return action.event.kind === "committed"
          ? withTrace(nextState, [{ traceId, stage: "commit", timestamp: now, segmentId: finalId, commitId: finalId, finalId, decision: "rejected", reason: rejectionReason, transcript: action.event.text }])
          : nextState;
      }
      const eventCount = action.event.kind === "provisional"
        ? { providerEvents: state.speech.debug.providerEvents + 1, provisionalEvents: state.speech.debug.provisionalEvents + 1 }
        : { providerEvents: state.speech.debug.providerEvents + 1, committedEvents: state.speech.debug.committedEvents + 1 };
      const normalizedText = action.event.text.trim();
      if (!normalizedText) {
        const emptyState = { ...nextState, speech: { ...state.speech, debug: { ...state.speech.debug, ...eventCount } } };
        return action.event.kind === "committed" ? withTrace(emptyState, [{ traceId, stage: "commit", timestamp: now, speechEventId, commitId: finalId, finalId, decision: "rejected", reason: "empty_transcript", transcript: action.event.text }]) : emptyState;
      }
      const update = applySpeechEvent(state.speech.canonical, { ...action.event, text: normalizedText }, now);
      if (action.event.kind === "committed") {
        nextState = withTrace(nextState, [
          { traceId, stage: "commit", timestamp: now, segmentId: finalId, commitId: finalId, finalId, decision: "committed", reason: "speechmatics_final_provenance", transcript: action.event.text, latencyMs: 0 },
          ...update.changes.map((change) => {
            const span = update.state.spans.find((item) => item.id === change.spanId)!;
            return {
              traceId: spanTraceIdFor(action.runId, change.spanId, change.spanRevision),
              stage: "span" as const,
              timestamp: now,
              segmentId: change.spanId,
              spanId: change.spanId,
              spanRevision: change.spanRevision,
              finalId: change.finalId,
              decision: change.decision,
              reason: change.closeReason ?? (change.decision === "opened" ? "provider_final_opened_span" : "provider_final_appended_to_span"),
              transcript: span.text,
              sourceFinalIds: span.sourceFinalIds,
            };
          }),
        ]);
      }
      return { ...nextState, speech: { ...state.speech, canonical: update.state, debug: { ...state.speech.debug, ...eventCount } } };
    }
    case "close-speech-span": {
      if (state.speech.debug.runId !== action.runId || state.status === "ended") return state;
      const update = closeCanonicalSpeechSpan(state.speech.canonical, action.spanId, action.spanRevision, action.reason, action.now);
      if (!update.changes.length) return state;
      const span = update.state.spans.find((item) => item.id === action.spanId)!;
      return withTrace({ ...state, speech: { ...state.speech, canonical: update.state } }, [{
        traceId: spanTraceIdFor(action.runId, span.id, span.revision),
        stage: "span",
        timestamp: action.now,
        segmentId: span.id,
        spanId: span.id,
        spanRevision: span.revision,
        decision: "closed",
        reason: action.reason,
        transcript: span.text,
        sourceFinalIds: span.sourceFinalIds,
      }]);
    }
    case "speech-paused":
      if (state.speech.debug.runId !== action.runId || state.speech.status !== "ready") return state;
      return { ...state, speech: { ...state.speech, status: "paused", canonical: { ...state.speech.canonical, provisional: undefined } } };
    case "speech-resumed":
      if (state.speech.debug.runId !== action.runId || state.speech.status !== "paused" || state.status !== "active") return state;
      return { ...state, speech: { ...state.speech, status: "ready" } };
    case "speech-stopped":
      if (state.speech.debug.runId !== action.runId) return state;
      return { ...state, speech: { ...state.speech, status: "ended", canonical: { ...state.speech.canonical, provisional: undefined } } };
    case "planner-gate": {
      const input = action.input ? plannerInputSummary(action.input) : undefined;
      const traceId = spanTraceIdFor(action.runId, action.spanId, action.spanRevision);
      return withTrace(state, [{ traceId, stage: "planner_gate", timestamp: action.now, segmentId: action.spanId, spanId: action.spanId, spanRevision: action.spanRevision, requestId: action.requestId, decision: action.decision, reason: action.reason, input, latencyMs: elapsedMs(spanRevisionTimestampFor(state.trace, action.spanId, action.spanRevision), action.now) }]);
    }
    case "planner-requested":
      if (state.status === "ended" || state.speech.debug.runId !== action.runId || state.planner.inFlightRequestId !== undefined) return state;
      return withTrace({ ...state, planner: { ...state.planner, status: "planning", requestId: action.requestId, inFlightRequestId: action.requestId, lastError: undefined, lastValidationError: undefined } }, [{ traceId: spanTraceIdFor(action.runId, action.spanId, action.spanRevision), stage: "planner", timestamp: action.now ?? 0, segmentId: action.spanId, spanId: action.spanId, spanRevision: action.spanRevision, requestId: action.requestId, decision: "started", reason: "planner_invoked_for_exact_span_revision", input: action.input ? plannerInputSummary(action.input) : undefined }]);
    case "planner-aborted": {
      if (state.status === "ended" || state.speech.debug.runId !== action.runId || state.planner.inFlightRequestId !== action.requestId) return state;
      return withTrace({ ...state, planner: { ...state.planner, status: "ready", inFlightRequestId: undefined } }, [{
        traceId: spanTraceIdFor(action.runId, action.spanId, action.spanRevision),
        stage: "planner",
        timestamp: action.now,
        segmentId: action.spanId,
        spanId: action.spanId,
        spanRevision: action.spanRevision,
        requestId: action.requestId,
        decision: "aborted",
        reason: action.reason,
        latencyMs: elapsedMs(action.startedAt, action.now),
      }]);
    }
    case "planner-decision": {
      if (state.status === "ended" || state.speech.debug.runId !== action.runId || state.planner.inFlightRequestId !== action.requestId) return state;
      if (!exactSpanRevision(state, action.spanId, action.spanRevision)) {
        return withTrace({ ...state, planner: { ...state.planner, status: "ready", inFlightRequestId: undefined } }, [{
          traceId: spanTraceIdFor(action.runId, action.spanId, action.spanRevision),
          stage: "planner",
          timestamp: action.now,
          segmentId: action.spanId,
          spanId: action.spanId,
          spanRevision: action.spanRevision,
          requestId: action.requestId,
          decision: "stale",
          reason: "canonical_span_revision_advanced",
          latencyMs: elapsedMs(action.startedAt, action.now),
        }]);
      }
      const validation = validateRuntimeDecision(action.decision, action.input);
      const segmentIds = actionSegmentIds(action);
      if (!validation.ok) return withTrace({ ...state, planner: { ...state.planner, status: "ready", inFlightRequestId: undefined, lastValidationError: validation.error } }, [{ traceId: spanTraceIdFor(action.runId, action.spanId, action.spanRevision), stage: "planner", timestamp: action.now, segmentId: action.spanId, spanId: action.spanId, spanRevision: action.spanRevision, requestId: action.requestId, decision: "structured_output_invalid", reason: validation.error, latencyMs: elapsedMs(action.startedAt, action.now) }]);
      const episode = compileCaptionEpisode(action.input, validation.decision, `caption-${action.runId}-${action.requestId}`, action.now);
      const correlatedIds = [...new Set([...segmentIds, ...(episode?.sourceSegmentIds ?? [])])];
      let nextState = withTrace(state, [
        { traceId: spanTraceIdFor(action.runId, action.spanId, action.spanRevision), stage: "planner" as const, timestamp: action.now, segmentId: action.spanId, spanId: action.spanId, spanRevision: action.spanRevision, requestId: action.requestId, decision: "completed" as const, reason: "structured_decision_received", output: validation.decision, latencyMs: elapsedMs(action.startedAt, action.now) },
        ...(validation.degradation ? [{ traceId: spanTraceIdFor(action.runId, action.spanId, action.spanRevision), stage: "planner" as const, timestamp: action.now, segmentId: action.spanId, spanId: action.spanId, spanRevision: action.spanRevision, requestId: action.requestId, decision: "validation_degraded" as const, reason: validation.degradation, output: validation.decision }] : []),
      ]);
      if (validation.decision.display.kind !== "QUIET" && !episode) {
        const error = "The grounded decision could not compile into the existing caption grammar.";
        nextState = withTrace(nextState, correlatedIds.map((segmentId) => {
          const spanRevision = state.speech.canonical.spans.find((span) => span.id === segmentId)?.revision;
          return { traceId: spanRevision === undefined ? traceIdFor(action.runId, segmentId) : spanTraceIdFor(action.runId, segmentId, spanRevision), stage: "compile", timestamp: action.now, segmentId, spanId: segmentId, spanRevision, requestId: action.requestId, decision: "failed", reason: error, displayIntent: validation.decision.display, learnerIntent: validation.decision.learner };
        }));
        return { ...nextState, planner: { ...state.planner, status: "error", inFlightRequestId: undefined, lastValidationError: error } };
      }
      nextState = withTrace(nextState, correlatedIds.map((segmentId) => {
        const spanRevision = state.speech.canonical.spans.find((span) => span.id === segmentId)?.revision;
        return {
          traceId: spanRevision === undefined ? traceIdFor(action.runId, segmentId) : spanTraceIdFor(action.runId, segmentId, spanRevision),
          stage: "compile" as const,
          timestamp: action.now,
          segmentId,
          spanId: segmentId,
          spanRevision,
          requestId: action.requestId,
          cueId: episode?.id,
          decision: episode ? "emit" as const : "no_emit" as const,
          reason: episode ? (episode.cue ? "effect_cue_emitted_with_canonical_context" : "plain_caption_emitted_with_canonical_context") : "quiet_intent",
          displayIntent: validation.decision.display,
          learnerIntent: validation.decision.learner,
          effectCue: episode?.cue,
        };
      }));
      const runtimeWithCue = validation.decision.learner.kind === "NONE"
        ? state.planner.runtime
        : showLearnerCue(state.planner.runtime, { id: `learner-${action.runId}-${action.requestId}`, kind: validation.decision.learner.kind, expiresAt: action.now + 3_500 });
      return { ...nextState, planner: { ...state.planner, status: "ready", inFlightRequestId: undefined, latestDecision: validation.decision, runtime: episode ? activateCaption(runtimeWithCue, episode) : runtimeWithCue, lastValidationError: undefined } };
    }
    case "planner-failed": {
      if (state.status === "ended" || state.speech.debug.runId !== action.runId || state.planner.inFlightRequestId !== action.requestId) return state;
      const now = action.now ?? 0;
      if (!exactSpanRevision(state, action.spanId, action.spanRevision)) {
        return withTrace({ ...state, planner: { ...state.planner, status: "ready", inFlightRequestId: undefined, lastError: action.message } }, [{
          traceId: spanTraceIdFor(action.runId, action.spanId, action.spanRevision),
          stage: "planner",
          timestamp: now,
          segmentId: action.spanId,
          spanId: action.spanId,
          spanRevision: action.spanRevision,
          requestId: action.requestId,
          decision: "stale",
          reason: "canonical_span_revision_advanced_before_fallback",
          latencyMs: elapsedMs(action.startedAt, now),
        }]);
      }
      const segmentIds = actionSegmentIds(action);
      const decision = fallbackFromGroundedSpeech(action.input);
      const episode = compileCaptionEpisode(action.input, decision, `caption-${action.runId}-${action.requestId}`, now);
      const correlatedIds = [...new Set([...segmentIds, ...(episode?.sourceSegmentIds ?? [])])];
      let failedState = withTrace({ ...state, planner: { ...state.planner, status: "ready" as const, inFlightRequestId: undefined, lastError: action.message, latestDecision: decision, runtime: episode ? activateCaption(state.planner.runtime, episode) : state.planner.runtime } }, [{ traceId: spanTraceIdFor(action.runId, action.spanId, action.spanRevision), stage: "planner", timestamp: now, segmentId: action.spanId, spanId: action.spanId, spanRevision: action.spanRevision, requestId: action.requestId, decision: "failed", reason: action.message, latencyMs: elapsedMs(action.startedAt, now) }]);
      failedState = withTrace(failedState, correlatedIds.map((segmentId) => {
        const spanRevision = state.speech.canonical.spans.find((span) => span.id === segmentId)?.revision;
        return { traceId: spanRevision === undefined ? traceIdFor(action.runId, segmentId) : spanTraceIdFor(action.runId, segmentId, spanRevision), stage: "compile", timestamp: now, segmentId, spanId: segmentId, spanRevision, requestId: action.requestId, cueId: episode?.id, decision: episode ? "emit" : "no_emit", reason: episode ? "provider_fallback_text_with_canonical_context" : "provider_fallback_quiet", displayIntent: decision.display, learnerIntent: decision.learner, effectCue: episode?.cue };
      }));
      return failedState;
    }
    case "debug-inject-decision": {
      if (!state.trace.enabled) return state;
      const validation = validateRuntimeDecision(action.decision, action.input);
      const segmentIds = action.input.recentSpeech.map((turn) => turn.id);
      if (!validation.ok) {
        return withTrace(state, segmentIds.map((segmentId) => ({ traceId: action.traceId, source: "synthetic", stage: "compile", timestamp: action.now, segmentId, decision: "failed", reason: validation.error })));
      }
      const episode = compileCaptionEpisode(action.input, validation.decision, action.episodeId, action.now);
      if (validation.decision.display.kind !== "QUIET" && !episode) {
        return withTrace(state, segmentIds.map((segmentId) => ({ traceId: action.traceId, source: "synthetic", stage: "compile", timestamp: action.now, segmentId, decision: "failed", reason: "The synthetic grounded decision could not compile into the existing caption grammar.", displayIntent: validation.decision.display, learnerIntent: validation.decision.learner })));
      }
      const traced = withTrace(state, segmentIds.map((segmentId) => ({
        traceId: action.traceId,
        source: "synthetic" as const,
        stage: "compile" as const,
        timestamp: action.now,
        segmentId,
        cueId: episode?.id,
        decision: episode ? "emit" as const : "no_emit" as const,
        reason: episode ? (episode.cue ? "effect_cue_emitted" : "plain_caption_emitted") : "quiet_intent",
        displayIntent: validation.decision.display,
        learnerIntent: validation.decision.learner,
        effectCue: episode?.cue,
      })));
      return episode ? { ...traced, planner: { ...traced.planner, runtime: activateCaption(traced.planner.runtime, episode) } } : traced;
    }
    case "renderer-activated": {
      const compileEvents = state.trace.events.filter((event) => event.stage === "compile" && event.decision === "emit" && event.cueId === action.episode.id);
      const fallbackSpan = state.speech.canonical.spans.find((span) => action.episode.sourceSegmentIds.includes(span.id));
      const correlations = compileEvents.length ? compileEvents : [{
        traceId: fallbackSpan ? spanTraceIdFor(state.speech.debug.runId, fallbackSpan.id, fallbackSpan.revision) : traceIdFor(state.speech.debug.runId, action.episode.id),
        source: "live" as const,
        segmentId: fallbackSpan?.id ?? action.episode.sourceSegmentIds[0],
        spanId: fallbackSpan?.id,
        spanRevision: fallbackSpan?.revision,
        requestId: undefined,
      }];
      const activated: TeachingTraceEventDraft[] = correlations.map((event) => ({
        traceId: event.traceId,
        source: event.source,
        stage: "render",
        timestamp: action.now,
        segmentId: event.segmentId,
        spanId: event.spanId,
        spanRevision: event.spanRevision,
        requestId: event.requestId,
        cueId: action.episode.id,
        decision: "activated",
        status: "rendered",
        presentationMode: action.presentationMode,
        reason: action.surfaceSource === "canonical_fallback" ? "canonical_speech_mounted" : action.episode.cue ? "effect_cue_mounted" : "plain_caption_mounted",
        effectCue: action.episode.cue,
        rendererState: action.rendererState,
        latencyMs: elapsedMs(event.spanId && event.spanRevision !== undefined ? spanRevisionTimestampFor(state.trace, event.spanId, event.spanRevision) : "timestamp" in event ? event.timestamp : undefined, action.now),
      }));
      const replacement: TeachingTraceEventDraft[] = action.previousEpisodeId && action.previousEpisodeId !== action.episode.id ? correlations.map((event) => ({
        traceId: event.traceId,
        source: event.source,
        stage: "render",
        timestamp: action.now,
        segmentId: event.segmentId,
        spanId: event.spanId,
        spanRevision: event.spanRevision,
        requestId: event.requestId,
        cueId: action.episode.id,
        decision: "replaced",
        status: "rendered",
        presentationMode: action.presentationMode,
        reason: `replaced:${action.previousEpisodeId}`,
        effectCue: action.episode.cue,
        rendererState: action.rendererState,
      })) : [];
      const suppressed: TeachingTraceEventDraft[] = action.suppressedEpisodeId ? correlations.map((event) => ({
        traceId: event.traceId,
        source: event.source,
        stage: "render",
        timestamp: action.now,
        segmentId: event.segmentId,
        spanId: event.spanId,
        spanRevision: event.spanRevision,
        requestId: event.requestId,
        cueId: action.suppressedEpisodeId,
        decision: "stale_suppressed",
        status: "suppressed",
        presentationMode: action.presentationMode,
        reason: "semantic_episode_older_than_latest_canonical_revision",
        rendererState: action.rendererState,
      })) : [];
      return withTrace(state, [...activated, ...replacement, ...suppressed]);
    }
    case "caption-expired": {
      const episode = state.planner.runtime.current?.id === action.episodeId ? state.planner.runtime.current : undefined;
      const next = { ...state, planner: { ...state.planner, runtime: expireCaption(state.planner.runtime, action.episodeId) } };
      if (!episode) return next;
      const span = state.speech.canonical.spans.find((item) => episode.sourceSegmentIds.includes(item.id));
      return withTrace(next, [{
        traceId: span ? spanTraceIdFor(state.speech.debug.runId, span.id, span.revision) : traceIdFor(state.speech.debug.runId, episode.id),
        stage: "render",
        timestamp: action.now ?? 0,
        segmentId: span?.id ?? episode.sourceSegmentIds[0],
        spanId: span?.id,
        spanRevision: span?.revision,
        cueId: episode.id,
        decision: "expired",
        status: "expired",
        presentationMode: action.presentationMode,
        reason: "episode_ttl_elapsed",
        effectCue: episode.cue,
        rendererState: { presentationMode: action.presentationMode, episodeId: episode.id, captionText: episode.clip.captionText },
      }]);
    }
    case "learner-cue-expired":
      return { ...state, planner: { ...state.planner, runtime: expireLearnerCue(state.planner.runtime, action.cueId) } };
    case "toggle-caption-lock":
      return state.status === "ended" ? state : { ...state, planner: { ...state.planner, runtime: toggleCaptionLock(state.planner.runtime) } };
    case "pause":
      return state.status === "active" ? { ...state, status: "paused", speech: state.speech.status === "ready" ? { ...state.speech, status: "paused", canonical: { ...state.speech.canonical, provisional: undefined } } : state.speech } : state;
    case "resume":
      return state.status === "paused" ? { ...state, status: "active", speech: state.speech.status === "paused" ? { ...state.speech, status: "ready" } : state.speech } : state;
    case "end":
      return { ...state, status: "ended", presentation: { status: "ended", stream: null }, speech: { ...state.speech, status: "ended", canonical: { ...state.speech.canonical, provisional: undefined } }, planner: { ...state.planner, inFlightRequestId: undefined } };
  }
}
