import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CoreLiveSession, type CoreLiveOptions } from '../lesson-stream/core/live-session';
import { MemoryCoreStore, deferred, proposalFor } from '../lesson-stream/core/live-test-fixtures';
import type { CoreInterpretationBinding } from '../lesson-stream/core/interpretation-context';
import type { SessionTraceDraft } from '../trace/contracts';
import { latencyNow } from '../trace/learner-latency';
import { speechEventFromSpeechmatics } from './speechmatics-adapter';
import type { SpeechEvent } from './speech-types';
import { applySpeechEvent, createInitialCanonicalSpeechState } from './canonical-speech';
import { scheduleCanonicalSpeechSpanClosure } from './use-canonical-speech-span-lifecycle';
import { sessionReducer, createInitialSessionState } from './session-state';
import { coreEventSchema } from '../lesson-stream/core/events';
import { replayCoreEvents } from '../lesson-stream/core/replay';

const sessions: CoreLiveSession[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(new Date('2026-09-10T00:00:00Z')); });
afterEach(() => { sessions.forEach(s => s.close()); sessions.length = 0; vi.useRealTimers(); });
function event(index: number, at = index * 200, text = `fragment${index}`, partial = false): Extract<SpeechEvent, { kind: 'committed' }> {
  return speechEventFromSpeechmatics({ message: partial ? 'AddPartialTranscript' : 'AddTranscript',
    metadata: { transcript: text, start_time: at / 1000, end_time: (at + 100) / 1000 },
    results: [{ type: 'word', start_time: at / 1000, end_time: (at + 100) / 1000, alternatives: [{ content: text, confidence: 0.99 }] }],
  } as never, { speechRunId: 'run', receivedAt: latencyNow(), receiptSequence: index, speechEventId: `receipt-${index}` }) as Extract<SpeechEvent, { kind: 'committed' }>;
}
async function open(options: Partial<CoreLiveOptions> = {}) {
  const traces: SessionTraceDraft[] = [], calls: CoreInterpretationBinding[] = [];
  const store = options.store ?? new MemoryCoreStore();
  const live = await CoreLiveSession.open({ lessonDomain: 'core', sessionId: 'ingress', speechRunId: 'run', store,
    trace: t => traces.push(t), interpreter: async b => { calls.push(b); return proposalFor(b); }, ...options });
  sessions.push(live); return { live, traces, calls, store: store as MemoryCoreStore };
}

describe('immutable final ingress through the existing Session Coordinator', () => {
  it('coalesces adjacent finals, freezes the in-flight prefix and consumes following arrivals once', async () => {
    const gate = deferred<unknown>(), calls: CoreInterpretationBinding[] = [];
    const { live } = await open({ interpreter: async b => { calls.push(b); return calls.length === 1 ? gate.promise : proposalFor(b); } });
    await live.commitSpeechEvidence(event(0).evidence!);
    await vi.advanceTimersByTimeAsync(120);
    await live.commitSpeechEvidence(event(1).evidence!);
    expect(live.coordinator.window.pendingCheckpointCount).toBe(2); expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(249); expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); expect(calls).toHaveLength(1);
    const captured = JSON.stringify(calls[0]!.context);
    await live.commitSpeechEvidence(event(2).evidence!);
    await vi.advanceTimersByTimeAsync(800);
    expect(JSON.stringify(calls[0]!.context)).toBe(captured); expect(calls[0]!.newEvidenceIds).toHaveLength(2);
    expect(live.runtime.pending).toHaveLength(3);
    gate.resolve(proposalFor(calls[0]!)); await vi.advanceTimersByTimeAsync(0);
    expect(calls.map(b => b.newEvidenceIds.length)).toEqual([2, 1]);
    expect(calls.flatMap(b => b.newEvidenceIds)).toEqual(live.runtime.replay.checkpoints.map(c => c.checkpointId));
    expect(live.state.processedThroughSequence).toBe(3);
  });
  it('makes max-wait progress during 1.6 seconds of continuous finals while one canonical span stays open', async () => {
    const { live, traces } = await open(); let canonical = createInitialCanonicalSpeechState();
    for (let i = 0; i < 8; i++) {
      const final = event(i);
      await live.commitSpeechEvidence(final.evidence!);
      canonical = applySpeechEvent(canonical, final, Date.now()).state;
      await vi.advanceTimersByTimeAsync(200);
      expect(canonical.spans).toHaveLength(1); expect(canonical.spans[0]!.status).toBe('open');
    }
    expect(live.state.processedThroughSequence).toBe(8);
    const requests = traces.filter(t => t.type === 'core.request');
    expect(requests).toHaveLength(2);
    expect(requests.every(t => t.payload.dispatchReason === 'max_wait')).toBe(true);
    expect(requests[0]!.payload.ingress?.[0]?.finalToDispatchMs).toBe(750);
  });
  it('keeps partial revisions non-authoritative and preserves canonical grouping/provenance', async () => {
    const { live } = await open(); let canonical = createInitialCanonicalSpeechState('run');
    for (const text of ['activation', 'activation energies', 'activation energy decreases']) {
      const partial = event(0, 0, text, true);
      canonical = applySpeechEvent(canonical, partial, Date.now()).state;
      expect(partial.evidence).toBeUndefined(); expect(live.runtime.pending).toHaveLength(0);
    }
    const final = event(0, 0, 'activation energy decreases');
    await live.commitSpeechEvidence(final.evidence!); canonical = applySpeechEvent(canonical, final, Date.now()).state;
    const second = event(1, 200, 'with a catalyst.');
    await live.commitSpeechEvidence(second.evidence!); canonical = applySpeechEvent(canonical, second, Date.now()).state;
    expect(canonical.provisional).toBeUndefined(); expect(canonical.identityScope).toBe('run');
    expect(canonical.spans).toHaveLength(1);
    expect(canonical.spans[0]).toMatchObject({ status: 'closed', closeReason: 'terminal_punctuation', text: 'activation energy decreases with a catalyst.' });
    expect(canonical.spans[0]!.sourceFinalIds).toEqual(live.runtime.replay.checkpoints.flatMap(c => c.sourceFinalIds));
    expect(live.runtime.events.filter(e => e.type === 'evidence.checkpoint_committed')).toHaveLength(2);
  });
  it('deduplicates retransmission by source identity, preserves repeated wording and rejects same-ID revision', async () => {
    const { live } = await open(); const first = event(0, 0, 'same words');
    await live.commitSpeechEvidence(first.evidence!);
    await vi.advanceTimersByTimeAsync(120);
    const duplicate = event(1, 0, 'same words');
    expect(await live.commitSpeechEvidence(duplicate.evidence!)).toBeUndefined();
    let canonical = applySpeechEvent(createInitialCanonicalSpeechState(), first).state;
    canonical = applySpeechEvent(canonical, duplicate).state; expect(canonical.finals).toHaveLength(1);
    await expect(live.commitSpeechEvidence(event(2, 0, 'changed words').evidence!)).rejects.toThrow('identity-collision');
    await live.commitSpeechEvidence(event(3, 200, 'same words').evidence!);
    await vi.advanceTimersByTimeAsync(250);
    expect(live.state.processedThroughSequence).toBe(2);
    expect(live.runtime.replay.checkpoints.map(c => c.text)).toEqual(['same words', 'same words']);
  });
  it('captures caller input before persistence and measures durable admission after a slow store', async () => {
    const { live, store, traces } = await open(); const gate = deferred();
    store.beforeAppend = async events => { if (events[0]!.type === 'evidence.checkpoint_committed') await gate.promise; };
    const mutable = structuredClone(event(0).evidence!);
    const admitted = live.commitSpeechEvidence(mutable);
    (mutable.words[0] as { text: string }).text = 'mutated';
    await vi.advanceTimersByTimeAsync(80); expect(live.runtime.pending).toHaveLength(0);
    gate.resolve(); await admitted;
    expect(live.runtime.replay.grounding.values().next().value!.words[0]!.text).toBe('fragment0');
    const trace = traces.find(t => t.type === 'core.checkpoint_committed')!;
    expect(trace.payload.ingress?.finalToAdmissionMs).toBe(80);
    expect(trace.payload.ingress?.eligibilityWaitMs).toBe(170);
    await vi.advanceTimersByTimeAsync(170); expect(live.state.processedThroughSequence).toBe(1);
  });
  it('prevents later evidence passing a failed write and retries the complete open tail in order', async () => {
    const { live, store } = await open(); let fail = true;
    store.beforeAppend = async events => { if (fail && events[0]!.type === 'evidence.checkpoint_committed') throw Error('disk-failed'); };
    const a = event(0).evidence!, b = event(1).evidence!;
    await expect(live.commitSpeechEvidence(a)).rejects.toThrow('disk-failed');
    await expect(live.commitSpeechEvidence(b)).rejects.toThrow('admission-incomplete');
    await expect(live.allocateSpeechRunId()).rejects.toThrow('admission-incomplete');
    await expect(live.runtime.end()).rejects.toThrow('admission-incomplete');
    expect(live.runtime.pending).toHaveLength(0); fail = false;
    const ended = live.finalize([a, b]); await vi.advanceTimersByTimeAsync(100);
    expect(await ended).toBe(true); expect(live.runtime.replay.checkpoints.map(c => c.text)).toEqual(['fragment0', 'fragment1']);
  });
  it('recovers solely from durable evidence and seals an open final tail despite trace failure', async () => {
    const { live, store } = await open({ trace: () => { throw Error('diagnostic-only'); } });
    live.cancel(); await live.commitSpeechEvidence(event(0).evidence!); live.close();
    const { live: restored } = await open({ store, trace: () => { throw Error('still-no-trace'); } });
    const tail = event(1); const canonical = applySpeechEvent(createInitialCanonicalSpeechState(), tail).state;
    expect(canonical.spans[0]!.status).toBe('open');
    const ended = restored.finalize(canonical.finals.map(f => f.evidence!)); await vi.advanceTimersByTimeAsync(100);
    expect(await ended).toBe(true); expect(restored.state.processedThroughSequence).toBe(2);
    expect(replayCoreEvents(store.events, 'ingress')).toEqual(restored.runtime.replay);
    await expect(restored.commitSpeechEvidence(event(2).evidence!)).rejects.toThrow();
  });
  it('retains finalized startup/pause/drain tails while suppressing volatile or stale-run input', () => {
    let state = sessionReducer(createInitialSessionState(), { type: 'begin-speech', runId: 'run' });
    expect(sessionReducer(state, { type: 'speech-event', runId: 'run', event: event(0) }).speech.canonical.finals).toHaveLength(1);
    state = sessionReducer(state, { type: 'speech-ready', runId: 'run' }); state = sessionReducer(state, { type: 'pause' });
    state = sessionReducer(state, { type: 'speech-event', runId: 'run', event: event(0, 0, 'volatile', true) });
    expect(state.speech.canonical.finals).toHaveLength(0);
    state = sessionReducer(state, { type: 'speech-event', runId: 'run', event: event(0) });
    expect(state.speech.canonical.finals).toHaveLength(1);
    expect(sessionReducer(state, { type: 'speech-event', runId: 'stale', event: event(1) })).toBe(state);
  });
  it('requires explicit final provenance when no canonical span exists', async () => {
    const { live } = await open(); await live.commitSpeechEvidence(event(0).evidence!);
    const committed = live.runtime.events.find(e => e.type === 'evidence.checkpoint_committed')!;
    expect(coreEventSchema.safeParse({ ...committed, grounding: { ...committed.grounding, immutableFinal: undefined } }).success).toBe(false);
    const corrupt = structuredClone(live.runtime.events);
    const changed = corrupt.find(e => e.type === 'evidence.checkpoint_committed')!;
    changed.grounding.immutableFinal!.providerFinalId = 'unrelated';
    expect(() => replayCoreEvents(corrupt, 'ingress')).toThrow('final-grounding-mismatch');
  });
});

it('reports the removed post-final grouping tax using real canonical rules and both existing coordinator paths', async () => {
  const scenarios = [
    { name: 'terminal punctuation', times: [0], terminal: true },
    { name: 'short pause', times: [0] },
    { name: 'continuous speech', times: Array.from({ length: 12 }, (_, i) => i * 200) },
    { name: 'long open span', times: Array.from({ length: 9 }, (_, i) => i * 700) },
    { name: 'multiple finals in one span', times: [0, 120, 240] },
  ];
  const report = [];
  for (const scenario of scenarios) {
    const origin = Date.now();
    const old = await open(), current = await open(); let canonical = createInitialCanonicalSpeechState();
    const received = new Map<string, number>(), closure = new Map<string, number>(), oldAdmitted = new Set<string>();
    let cancel = () => {};
    const admitClosed = () => {
      for (const span of canonical.spans) if (span.status === 'closed' && !oldAdmitted.has(span.id)) {
        oldAdmitted.add(span.id); span.sourceFinalIds.forEach(id => closure.set(id, Date.now() - origin));
        void old.live.commitClosedSpan(span);
      }
    };
    for (const [i, at] of scenario.times.entries()) {
      await vi.advanceTimersByTimeAsync(origin + at - Date.now());
      const final = event(i, at, scenario.terminal ? 'final.' : `word${i}`);
      received.set(final.evidence!.evidenceId, at);
      await current.live.commitSpeechEvidence(final.evidence!);
      canonical = applySpeechEvent(canonical, final, Date.now()).state; admitClosed(); cancel();
      cancel = scheduleCanonicalSpeechSpanClosure({ canonicalSpeech: canonical, speechRunId: 'run', dispatch: action => {
        if (action.type !== 'close-speech-span') throw Error('unexpected-action');
        const state = { ...createInitialSessionState(), status: 'active' as const,
          speech: { status: 'ready' as const, canonical, debug: { runId: 'run', provisionalEvents: 0, committedEvents: 0 } } };
        canonical = sessionReducer(state, action).speech.canonical; admitClosed();
      } });
    }
    await vi.advanceTimersByTimeAsync(1200); cancel();
    expect(canonical.spans).toHaveLength(1); expect(current.live.state.processedThroughSequence).toBe(scenario.times.length);
    expect(old.live.state.processedThroughSequence).toBe(1);
    const rows = [...received].map(([id, at]) => {
      const checkpointId = JSON.stringify(['checkpoint', id]);
      const admission = current.traces.find(t => t.type === 'core.checkpoint_committed' && t.payload.checkpointId === checkpointId)!;
      const request = current.traces.find(t => t.type === 'core.request' && t.payload.checkpointIds.includes(checkpointId))!;
      if (admission.type !== 'core.checkpoint_committed' || request.type !== 'core.request') throw Error('missing-trace');
      const dispatch = request.payload.ingress!.find(t => t.checkpointId === checkpointId)!;
      return { finalAtMs: at, oldFinalToAdmissionMs: closure.get(id)! - at,
        newFinalToAdmissionMs: admission.payload.ingress!.finalToAdmissionMs!,
        newFinalToEligibilityMsAtAdmission: admission.payload.ingress!.finalToEligibilityMs!,
        newFinalToDispatchMs: dispatch.finalToDispatchMs!,
        actualCoalescingWaitMs: dispatch.dispatchedAt! - admission.payload.ingress!.admittedAt! };
    });
    report.push({ scenario: scenario.name, rows }); old.live.close(); current.live.close();
  }
  expect(report.map(s => s.rows[0]!.oldFinalToAdmissionMs)).toEqual([0, 900, 3100, 6500, 1140]);
  expect(report.map(s => s.rows[0]!.newFinalToDispatchMs)).toEqual([250, 250, 750, 250, 490]);
  expect(report.flatMap(s => s.rows).every(r => r.newFinalToAdmissionMs === 0)).toBe(true);
  if (process.env.CUELAYER_INGRESS_REPORT === '1') {
    mkdirSync('artifacts/speech-ingress', { recursive: true });
    writeFileSync('artifacts/speech-ingress/latency-comparison.json', JSON.stringify({
      clock: 'synthetic post-final milliseconds; zero store/model service time; no measured provider latency', report }, null, 2));
  }
});
