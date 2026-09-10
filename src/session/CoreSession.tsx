import { useCallback, useEffect, useRef, useState } from 'react';
import type { CoreLiveSession } from '../lesson-stream/core/live-session';
import type { SessionTraceController } from '../trace/use-session-trace';
import { SessionWorkspace } from './SessionWorkspace';
import type { SessionTeachingHook } from './session-teaching';
import { openCoreSession } from './core-session';
import type { ImmutableSpeechEvidence } from './immutable-speech-evidence';

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
  const admitSpeechEvidence = useCallback((evidence: ImmutableSpeechEvidence) => {
    if (!live) { setError('lesson-runtime-not-ready'); return; }
    void live.commitSpeechEvidence(evidence).catch(reason => setError(reason instanceof Error ? reason.message : 'checkpoint-commit-failed'));
  }, [live]);
  const allocateSpeechRunId = useCallback(async () => {
    if (!live) throw new Error('lesson-runtime-not-ready');
    return live.allocateSpeechRunId();
  }, [live]);
  const endLesson = useCallback(async (tail: { canonicalSpeech?: import('./speech-types').CanonicalSpeechState; speechRunId?: import('./speech-types').SpeechRunId } = {}) => {
    if (!live) return false;
    live.resume(); // Explicit end drains even a paused host; sidecars remain best-effort.
    const ended = await live.finalize(tail.canonicalSpeech?.finals.flatMap(final => final.evidence ? [final.evidence] : []), tail.speechRunId);
    refresh(n => n + 1);
    return ended;
  }, [live]);
  const resumeInterpretation = useCallback(() => {
    if (!live) return;
    void (async () => {
      // Retry an incomplete admission in original receipt order before resuming.
      for (const final of current.current.canonicalSpeech.finals) if (final.evidence) await live.commitSpeechEvidence(final.evidence);
      setError(undefined); live.resume(); refresh(n => n + 1);
    })().catch(reason => setError(reason instanceof Error ? reason.message : 'checkpoint-commit-failed'));
  }, [live]);
  const health = live?.health;
  const oldestPendingAgeMs = health?.oldestPendingAgeMs ?? 0;
  return { domain: 'core', source: live?.runtime, ended: live?.runtime.replay.ended ?? false,
    status: !live ? (error ? 'degraded' : 'restoring') : health?.error || error ? 'degraded' : health?.inFlight ? 'interpreting' : 'ready',
    error: error ?? health?.error, pendingCount: health?.pendingCount ?? 0,
    health: { pendingCount: health?.pendingCount ?? 0, oldestPendingAgeMs, inFlightAgeMs: 0,
      paused: health?.paused ?? false, consecutiveFailures: health?.consecutiveFailures ?? 0,
      lagging: oldestPendingAgeMs >= 10_000 || !!health?.consecutiveFailures },
    resumeInterpretation, allocateSpeechRunId, admitSpeechEvidence, endLesson };
};
export default function CoreSession({ trace }: { trace: SessionTraceController }) {
  return <SessionWorkspace trace={trace} useTeaching={useCoreTeaching} />;
}
