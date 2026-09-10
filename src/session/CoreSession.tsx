import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CoreLiveSession } from '../lesson-stream/core/live-session';
import type { SessionTraceController } from '../trace/use-session-trace';
import { SessionWorkspace } from './SessionWorkspace';
import type { SessionTeachingHook } from './session-teaching';
import { openCoreSession } from './core-session';

export const useCoreTeaching: SessionTeachingHook = input => {
  const [live, setLive] = useState<CoreLiveSession>();
  const [error, setError] = useState<string>();
  const [, refresh] = useState(0);
  const current = useRef(input); current.current = input;
  useEffect(() => {
    let cancelled = false;
    let owner: CoreLiveSession | undefined;
    let unsubscribe: (() => void) | undefined;
    setLive(undefined); setError(undefined);
    void Promise.resolve().then(() => cancelled ? undefined : openCoreSession({ sessionId: input.sessionId, speechRunId: current.current.speechRunId, trace: input.onTrace })).then(session => {
      if (!session) return;
      if (cancelled) { session.close(); return; }
      owner = session;
      if (current.current.sessionStatus === 'paused') session.cancel();
      setLive(session);
      unsubscribe = session.runtime.subscribe(() => refresh(n => n + 1));
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'lesson-store-unavailable'); });
    const timer = setInterval(() => { if (owner) refresh(n => n + 1); }, 1_000);
    return () => { cancelled = true; clearInterval(timer); unsubscribe?.(); owner?.close(); };
  }, [input.sessionId, input.onTrace]);
  useEffect(() => {
    if (!live || live.runtime.replay.ended) return;
    if (input.sessionStatus === 'paused') live.cancel();
    else live.resume();
  }, [live, input.sessionStatus]);
  useEffect(() => {
    if (!live || live.runtime.replay.ended || input.sessionStatus === 'ended') return;
    let cancelled = false;
    void (async () => {
      for (const span of input.canonicalSpeech.spans.filter(span => span.status === 'closed')) {
        if (cancelled) return;
        await live.commitClosedSpan(span, input.speechRunId);
      }
    })().catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'checkpoint-commit-failed'); });
    return () => { cancelled = true; };
  }, [live, input.canonicalSpeech.spans, input.speechRunId, input.sessionStatus]);
  const allocateSpeechRunId = useCallback(async () => {
    if (!live) throw new Error('lesson-runtime-not-ready');
    return live.allocateSpeechRunId();
  }, [live]);
  const endLesson = useCallback(async (tail: { canonicalSpeech?: import('./speech-types').CanonicalSpeechState; speechRunId?: import('./speech-types').SpeechRunId } = {}) => {
    if (!live) return false;
    live.resume(); // Explicit end drains even a paused host; sidecars remain best-effort.
    const ended = await live.finalize(tail.canonicalSpeech?.spans.filter(span => span.status === 'closed'), tail.speechRunId);
    refresh(n => n + 1);
    return ended;
  }, [live]);
  const resumeInterpretation = useCallback(() => { setError(undefined); live?.resume(); refresh(n => n + 1); }, [live]);
  const health = live?.health;
  const events = live?.runtime.events;
  const oldestPendingAt = useMemo(() => {
    const pendingIds = new Set(live?.runtime.pending.map(item => item.checkpointId));
    let oldest: number | undefined;
    for (const event of events ?? []) if (event.type === 'evidence.checkpoint_committed' && pendingIds.has(event.checkpoint.checkpointId)) {
      const time = Date.parse(event.timestamp); oldest = oldest === undefined ? time : Math.min(oldest, time);
    }
    return oldest;
  }, [live, events]);
  const oldestPendingAgeMs = oldestPendingAt === undefined ? 0 : Math.max(0, Date.now() - oldestPendingAt);
  return { domain: 'core', source: live?.runtime, ended: live?.runtime.replay.ended ?? false,
    status: !live ? (error ? 'degraded' : 'restoring') : health?.error || error ? 'degraded' : health?.inFlight ? 'interpreting' : 'ready',
    error: error ?? health?.error, pendingCount: health?.pendingCount ?? 0,
    health: { pendingCount: health?.pendingCount ?? 0, oldestPendingAgeMs, inFlightAgeMs: 0,
      paused: health?.paused ?? false, consecutiveFailures: health?.consecutiveFailures ?? 0,
      lagging: oldestPendingAgeMs >= 10_000 || !!health?.consecutiveFailures },
    resumeInterpretation, allocateSpeechRunId, endLesson };
};
export default function CoreSession({ trace }: { trace: SessionTraceController }) {
  return <SessionWorkspace trace={trace} useTeaching={useCoreTeaching} />;
}
