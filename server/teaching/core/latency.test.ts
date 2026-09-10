import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { coreInterpretationResponse } from './endpoint.ts';
import type { CoreProviderTransport } from './openai-interpreter.ts';
import { createHttpCoreInterpreter } from '../../../src/lesson-stream/core/http-interpreter.ts';
import { CoreLiveSession } from '../../../src/lesson-stream/core/live-session.ts';
import { closedSpan, MemoryCoreStore, proposalFor } from '../../../src/lesson-stream/core/live-test-fixtures.ts';
import { interpretationDeadlines } from '../../../src/lesson-stream/runtime-policy.ts';
import type { SessionTraceDraft } from '../../../src/trace/contracts.ts';

const sessions: CoreLiveSession[] = [];
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] }));
afterEach(() => { sessions.splice(0).forEach(s => s.close()); vi.useRealTimers(); });
async function setup(delay: number, brokenTrace = false) {
  let latency = delay;
  const signals: AbortSignal[] = [];
  const transport: CoreProviderTransport = async (request, signal) => {
    signals.push(signal!);
    await new Promise(resolve => setTimeout(resolve, latency)); // Deliberately ignores abort.
    return { output_text: JSON.stringify(proposalFor({ context: JSON.parse(request.input[1]!.content) }, true)),
      model: 'offline-actual', usage: { input_tokens: 1234, output_tokens: 89,
        input_tokens_details: { cached_tokens: 100 }, output_tokens_details: { reasoning_tokens: 20 } } };
  };
  const fetcher: typeof fetch = async (_url, options) => {
    const result = await coreInterpretationResponse(JSON.parse(options!.body as string), { transport, signal: options!.signal! });
    return new Response(JSON.stringify(result.body), { status: result.status });
  };
  const traces: SessionTraceDraft[] = [];
  const live = await CoreLiveSession.open({ lessonDomain: 'core', sessionId: crypto.randomUUID(), speechRunId: 0,
    store: new MemoryCoreStore(), interpreter: createHttpCoreInterpreter(fetcher),
    trace: draft => { traces.push(draft); if (brokenTrace) throw new Error('broken-diagnostics'); } });
  sessions.push(live);
  return { live, traces, signals, setLatency: (ms: number) => { latency = ms; } };
}
function payloads(traces: SessionTraceDraft[], type: SessionTraceDraft['type']) {
  return traces.filter(d => d.type === type).map(d => d.payload);
}
it('central policy keeps the provider at 12s and the client strictly later at 14s', () => {
  expect(interpretationDeadlines()).toEqual({ providerMs: 12_000, clientMs: 14_000 });
  for (const override of [undefined, '6000', '12000', '30000', '60000', 'bad']) {
    const { providerMs, clientMs } = interpretationDeadlines(override, true);
    expect(clientMs - providerMs).toBe(2_000);
  }
});
it.each([false, true])('7s provider success survives the old cutoff; diagnostic throws=%s', async brokenTrace => {
  const { live, traces, signals } = await setup(7_000, brokenTrace);
  await live.commitClosedSpan(closedSpan());
  await vi.advanceTimersByTimeAsync(6_001);
  expect(signals[0]!.aborted).toBe(false); expect(live.state.knowledge.revision).toBe(0);
  await live.commitClosedSpan(closedSpan('queued'));
  await vi.advanceTimersByTimeAsync(999);
  expect(live.state.knowledge.revision).toBe(1); expect(live.state.processedThroughSequence).toBe(1);
  expect(payloads(traces, 'core.request')[0]).toMatchObject({ scheduledAt: expect.any(String), queue: {
    pendingCheckpointCount: 1, oldestPendingAgeMs: 0, requestCheckpointCount: 1, consecutiveFailures: 0, paused: false, backingOff: false } });
  expect(payloads(traces, 'core.provider_request')[0]).toMatchObject({ startedAt: expect.any(String), weight: {
    serializedCharacters: expect.any(Number), serializedBytes: expect.any(Number), estimatedTokens: expect.any(Number),
    estimate: 'ceil-json-characters-divided-by-four', contextCharacters: expect.any(Number), contextEstimatedTokens: expect.any(Number),
    entityCount: 0, newEvidenceCheckpointCount: 1, requestedMaxOutputTokens: 8192 } });
  expect(payloads(traces, 'core.provider_response')[0]).toMatchObject({ startedAt: expect.any(String), completedAt: expect.any(String),
    elapsedMs: 7000, outcome: 'success', response: { model: 'offline-actual', usage: { input_tokens: 1234, output_tokens: 89,
      input_tokens_details: { cached_tokens: 100 }, output_tokens_details: { reasoning_tokens: 20 } } } });
  for (const type of ['core.http', 'core.endpoint'] as const) expect(payloads(traces, type)[0]).toMatchObject({
    startedAt: expect.any(String), completedAt: expect.any(String), elapsedMs: 7000, outcome: 'success' });
  expect(payloads(traces, 'core.attempt_completed')[0]).toMatchObject({ elapsedMs: 7000, outcome: 'accepted', queue: {
    pendingCheckpointCount: 1, oldestPendingAgeMs: 999, requestCheckpointCount: 1, processedThroughSequence: 1, consecutiveFailures: 0 } });
});
it.each([false, true])('provider wins before client grace, retains truth/pending and ignores late success; diagnostic throws=%s', async brokenTrace => {
  const { live, traces, setLatency } = await setup(0, brokenTrace);
  await live.commitClosedSpan(closedSpan('accepted')); await vi.advanceTimersByTimeAsync(0);
  const before = structuredClone(live.state);
  setLatency(13_000);
  await live.commitClosedSpan(closedSpan('slow')); await live.commitClosedSpan(closedSpan('backlog'));
  await vi.advanceTimersByTimeAsync(12_000);
  expect(live.state).toEqual(before); expect(live.runtime.pending).toHaveLength(2);
  expect(live.health).toMatchObject({ inFlight: false, consecutiveFailures: 1, pendingCount: 2 });
  expect(payloads(traces, 'core.provider_response').at(-1)).toMatchObject({ elapsedMs: 12000, outcome: 'failure', abortSource: 'provider_deadline' });
  for (const type of ['core.http', 'core.endpoint'] as const) expect(payloads(traces, type).at(-1)).toMatchObject({
    elapsedMs: 12000, outcome: 'failure', abortSource: 'provider_deadline' });
  expect(payloads(traces, 'core.attempt_completed').at(-1)).toMatchObject({ elapsedMs: 12000, outcome: 'failure', abortSource: 'provider_deadline',
    queue: { pendingCheckpointCount: 2, oldestPendingAgeMs: 12000, requestCheckpointCount: 1,
      processedThroughSequence: 1, consecutiveFailures: 1, paused: false, backingOff: true } });
  live.cancel(); // Prevent automatic retry while checking the ignored late result.
  await vi.advanceTimersByTimeAsync(2_000);
  expect(live.state).toEqual(before); expect(live.runtime.pending).toHaveLength(2);
  setLatency(0); live.resume(); await vi.advanceTimersByTimeAsync(0);
  expect(live.state.processedThroughSequence).toBe(2); // Existing failed-prefix retry remains one checkpoint.
  await vi.advanceTimersByTimeAsync(1);
  expect(live.runtime.pending).toHaveLength(0);
});
it.each(['manual', 'stale', 'disconnect', 'client', 'transport'] as const)('distinguishes %s failures', async kind => {
  const traces: SessionTraceDraft[] = [];
  const disconnect = new AbortController();
  const live = await CoreLiveSession.open({ lessonDomain: 'core', sessionId: crypto.randomUUID(), speechRunId: 0, store: new MemoryCoreStore(),
    trace: draft => traces.push(draft), interpreter: kind === 'client' ? () => new Promise(() => undefined) : createHttpCoreInterpreter(async (_url, options) => {
      const result = await coreInterpretationResponse(JSON.parse(options!.body as string), {
        signal: kind === 'disconnect' ? disconnect.signal : options!.signal!,
        transport: kind === 'transport' ? async () => { throw new Error('offline-unavailable'); } : () => new Promise(() => undefined) });
      return new Response(JSON.stringify(result.body), { status: result.status });
    }) });
  sessions.push(live); await live.commitClosedSpan(closedSpan()); await vi.advanceTimersByTimeAsync(0);
  if (kind === 'manual') live.cancel();
  if (kind === 'stale') live.setSpeechRun(1);
  if (kind === 'disconnect') disconnect.abort('client-disconnected');
  await vi.advanceTimersByTimeAsync(kind === 'client' ? 14_000 : 0);
  expect(live.state.knowledge.revision).toBe(0); expect(live.runtime.pending).toHaveLength(1);
  expect(payloads(traces, 'core.attempt_completed')[0]).toMatchObject({ outcome: 'failure', abortSource: {
    manual: 'session_cancellation', stale: 'stale_speech_generation', disconnect: 'client_disconnect', client: 'client_deadline', transport: 'provider_transport_failure',
  }[kind] });
  if (kind === 'disconnect') expect(payloads(traces, 'core.endpoint')[0]).toMatchObject({ abortSource: 'client_disconnect' });
});
