// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { SessionPage } from './SessionPage';
import { CoreLiveSession } from '../lesson-stream/core/live-session';
import { LessonStreamRuntime } from '../lesson-stream/runtime';
import { LocalLessonEventStore } from '../lesson-stream/store';
import { closedSpan, deferred, proposalFor, proposedStep } from '../lesson-stream/core/live-test-fixtures';
import type { CoreInterpretationBinding } from '../lesson-stream/core/interpretation-context';
import type { CoreProposal } from '../lesson-stream/core/interpretation-proposal';
import { CapabilityRegistry } from '../teaching-representation/registry';
import { SessionTraceRuntime } from '../trace/runtime';
import type { SpeechEvent, SpeechRunId } from './speech-types';
import * as canonicalSpeech from './canonical-speech';
import { speechEventFromSpeechmatics } from './speechmatics-adapter';
import { latencyNow } from '../trace/learner-latency';
import { lessonStartedEvent } from '../lesson-stream/events';

vi.mock('./SpeechmaticsSessionProvider', () => ({ usePrepareSpeechmaticsAudioContext: () => () => undefined }));
const speech = vi.hoisted(() => ({ callbacks: undefined as undefined | { onEvent(run: SpeechRunId, event: SpeechEvent): void; onReady(run: SpeechRunId): void }, run: 0 as SpeechRunId }));
vi.mock('./use-speechmatics-session', () => ({ speechStartFailureFrom: () => ({ code: 'test', message: 'test' }), useSpeechmaticsSession: (callbacks: NonNullable<typeof speech.callbacks>) => {
  speech.callbacks = callbacks;
  return { start: async (run: SpeechRunId) => { speech.run = run; callbacks.onReady(run); }, stop: async () => undefined, pause: vi.fn(), resume: vi.fn() };
} }));
let host: HTMLDivElement, root: Root, live: CoreLiveSession | undefined;
let propose: (binding: Pick<CoreInterpretationBinding, 'context'>) => CoreProposal;
let status: number;
let opens: MockInstance<typeof CoreLiveSession.open>;
let legacyOpens: MockInstance<typeof LessonStreamRuntime.open>;
let requests: string[];
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('requestAnimationFrame', vi.fn()); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1280);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(620);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(470);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(180);
  history.replaceState(null, '', '/session');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  live = undefined; status = 200; requests = []; propose = binding => proposalFor(binding, true);
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    requests.push(url);
    const binding = JSON.parse(options.body as string);
    return { ok: status === 200, json: async () => status === 200 ? { proposal: propose(binding) } : { error: 'core-provider-unavailable' } };
  }));
  opens = vi.spyOn(CoreLiveSession, 'open'); legacyOpens = vi.spyOn(LessonStreamRuntime, 'open');
});
afterEach(async () => { await act(() => root.unmount()); host.remove(); live?.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) { await act(async () => { await new Promise(r => setTimeout(r, 5)); }); if (check()) return; }
  throw new Error(`route-timeout: ${host.textContent}`);
}
async function mount() {
  await act(() => root.render(<StrictMode><SessionPage /></StrictMode>));
  await until(() => !!host.querySelector('[data-lesson-domain]') || !!host.querySelector('[role=alert]'));
  if (host.querySelector('[data-lesson-domain=core]')) {
    await until(() => !!host.querySelector('[data-domain=core]'));
    live = await opens.mock.results.at(-1)!.value;
  }
}
async function commit(id = 'first', text = 'Synthetic A relates to B.') {
  await act(async () => { await live!.commitClosedSpan(closedSpan(id, text)); await live!.currentAttempt; });
}
async function reopen() {
  await act(() => root.unmount()); root = createRoot(host); await mount();
}
it('normal new /session durably claims Core, mounts the reviewed surface, never opens legacy or dual-writes, and reloads exact accepted truth', async () => {
  await mount();
  const id = new URL(location.href).searchParams.get('sessionId')!;
  expect(await LocalLessonEventStore.resolveDomain(id, { create: false })).toBe('core');
  expect(opens).toHaveBeenCalledTimes(1); expect(legacyOpens).not.toHaveBeenCalled();
  await commit();
  const before = structuredClone(live!.runtime.replay);
  expect(host.querySelector('[data-domain=core]')?.textContent).toContain('B');
  expect(host.querySelector('[data-board-item-id]')).toBeNull();
  expect(before.events.every(e => e.schemaVersion === 'lesson-event-v5-core')).toBe(true);
  expect(requests).toEqual(['/api/teaching/core-interpretation']);
  await reopen();
  expect(live!.runtime.replay).toEqual(before);
  expect(requests).toHaveLength(1); expect(legacyOpens).not.toHaveBeenCalled();
  await commit(); // Same immutable evidence is idempotent after reload.
  expect(live!.runtime.replay).toEqual(before); expect(requests).toHaveLength(1);
  expect(host.querySelector('[data-domain=core]')).not.toBeNull();
});
it('delayed and failed real persistence cannot publish speculative semantic content or artifacts; retry consumes once', async () => {
  await mount(); await commit();
  const before = structuredClone(live!.state), surface = host.querySelector('[data-domain=core]')!.textContent;
  const gate = deferred(); const entered = deferred();
  const original = LocalLessonEventStore.prototype.append;
  const append = vi.spyOn(LocalLessonEventStore.prototype, 'append').mockImplementation(async function(this: LocalLessonEventStore, events, signal) {
    if (events.some(e => (e as { type?: string }).type === 'core.step_accepted')) { entered.resolve(); await gate.promise; }
    return original.call(this, events, signal);
  });
  await act(async () => { await live!.commitClosedSpan(closedSpan('second')); await entered.promise; });
  expect(live!.state).toEqual(before); expect(host.querySelector('[data-domain=core]')!.textContent).toBe(surface);
  await act(async () => { gate.reject(new Error('storage-failed')); await live!.currentAttempt; });
  expect(live!.state).toEqual(before); expect(live!.health.pendingCount).toBe(1);
  expect(host.querySelector('[data-domain=core]')!.textContent).toBe(surface);
  append.mockRestore();
  await act(async () => { live!.resume(); await live!.currentAttempt; });
  expect(live!.health.pendingCount).toBe(0); expect(live!.state.processedThroughSequence).toBe(2);
  expect(live!.runtime.events.filter(e => e.type === 'core.step_accepted')).toHaveLength(2);
});
it.each(['unavailable', 'invalid'] as const)('provider %s preserves accepted state, visuals and pending evidence', async failure => {
  await mount(); await commit(); const before = structuredClone(live!.state), text = host.textContent;
  if (failure === 'unavailable') status = 503;
  else propose = () => ({ outcome: { kind: 'bad' } }) as unknown as CoreProposal;
  await commit('second');
  expect(live!.state).toEqual(before); expect(live!.health.pendingCount).toBe(1);
  expect(host.querySelector('[data-domain=core]')?.textContent).toContain('B');
  expect(host.textContent).toContain(text!.slice(0, 8));
  if (failure === 'invalid') expect(live!.health.paused).toBe(true);
});
it('revision preserves semantic and artifact identity through the production host scope', async () => {
  await mount(); await commit();
  const core = Object.values(live!.state.knowledge.cores)[0], object = Object.values(core.objects)[0];
  const beforeNodes = [...host.querySelectorAll('[data-artifact-id]')];
  propose = binding => {
    const result = proposalFor(binding), step = proposedStep(result);
    const target = binding.context.entities.find(e => e.text === 'A')!;
    expect(target.capabilities).toContain('revise');
    step.knowledgeOps = [{ action: 'REVISE_OBJECT', target: { existing: target.handle }, correctionEvidence: null,
      value: { text: 'A revised', provenance: { speech: [step.consumes[0]], state: [], domain: null } } }];
    return result;
  };
  await commit('revision', 'A revised.');
  expect(live!.state.knowledge.cores[core.id].objects[object.id].value.text).toBe('A revised');
  expect(host.textContent).toContain('A revised');
  expect([...host.querySelectorAll('[data-artifact-id]')].some(node => beforeNodes.includes(node))).toBe(true);
});
it('representation renderer failure preserves accepted semantic truth and recovers on later acceptance', async () => {
  await mount(); await commit();
  const resolve = CapabilityRegistry.prototype.resolve;
  const render = vi.spyOn(CapabilityRegistry.prototype, 'resolve').mockImplementation(function(this: CapabilityRegistry, id) {
    return { ...resolve.call(this, id), render: () => { throw Error('renderer-failed'); } };
  });
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await commit('next');
  expect(live!.state.processedThroughSequence).toBe(2); expect(live!.state.knowledge.revision).toBe(2);
  render.mockRestore(); await commit('recover');
  expect(host.querySelector('[data-domain=core]')?.textContent).toContain('B');
  expect(live!.state.processedThroughSequence).toBe(3); consoleError.mockRestore();
});
it('finalization drains a held semantic request, persists the end, and completed-trace reload retains the lesson identity', async () => {
  await mount(); const gate = deferred();
  const fetcher = vi.mocked(fetch); const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (...args: Parameters<typeof fetch>) => { await gate.promise; return original(...args); });
  let ended: Promise<boolean>;
  await act(async () => { await live!.commitClosedSpan(closedSpan('tail')); ended = live!.finalize(); });
  expect(live!.runtime.replay.ended).toBe(false);
  await act(async () => { gate.resolve(); expect(await ended!).toBe(true); });
  const before = structuredClone(live!.runtime.replay), url = location.href;
  const trace = await SessionTraceRuntime.open({ requestedSessionId: live!.runtime.sessionId, path: '/session', environment: 'test', preserveSessionIdentity: true });
  await trace.complete('test-ended'); trace.close();
  await reopen(); expect(location.href).toBe(url); expect(live!.runtime.replay).toEqual(before);
});
it.each(['lesson-event-v3-learner-agency', 'lesson-event-v4-continuous'] as const)('restores stored legacy %s through the legacy runtime and surface only', async schemaVersion => {
  const store = await LocalLessonEventStore.open();
  await store.append([{ ...lessonStartedEvent('historical-session', 1), schemaVersion }]); store.close();
  history.replaceState(null, '', '/session?sessionId=historical-session&lessonDomain=core');
  await mount();
  expect(host.querySelector('[data-lesson-domain=legacy]')).not.toBeNull();
  expect(opens).not.toHaveBeenCalled(); expect(legacyOpens).toHaveBeenCalled(); expect(requests).toEqual([]);
});
it('a missing durable domain fails closed on the real route, without a runtime or provider call', async () => {
  history.replaceState(null, '', '/session?sessionId=unknown-session&lessonDomain=core');
  await mount(); expect(host.textContent).toContain('lesson-domain-missing');
  expect(opens).not.toHaveBeenCalled(); expect(legacyOpens).not.toHaveBeenCalled(); expect(requests).toEqual([]);
});
it('an immutable provider final reaches the Core scheduler through the normal page while its transcript remains open', async () => {
  await mount();
  await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Enable mic')!.click(); });
  await until(() => host.textContent!.includes('Mute mic'));
  await act(() => { speech.callbacks!.onEvent(speech.run, speechEventFromSpeechmatics({ message: 'AddTranscript', metadata: { transcript: 'A committed synthetic statement', start_time: 0, end_time: 1 }, results: [] } as never, { speechRunId: speech.run, receivedAt: latencyNow(), receiptSequence: 0, speechEventId: 'synthetic-final' })!); });
  await until(() => live!.state.processedThroughSequence === 1);
  expect(live!.runtime.replay.grounding.size).toBe(1);
  expect(live!.runtime.replay.checkpoints[0].speechRunId).toBe(speech.run);
  expect(live!.runtime.replay.checkpoints[0].sourceFinalIds).toHaveLength(1);
  expect(live!.runtime.events.filter(e => e.type === 'speech.run_allocated')).toHaveLength(1);
  expect(legacyOpens).not.toHaveBeenCalled();
});

it('normal production admission and 750 ms Live progress continue through a canonical span open for 1.6 seconds', async () => {
  await mount();
  await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Enable mic')!.click(); });
  await until(() => host.textContent!.includes('Mute mic'));
  const assembly = vi.spyOn(canonicalSpeech, 'applySpeechEvent');
  vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
  try {
    for (let i = 0; i < 8; i++) {
      await act(async () => {
        speech.callbacks!.onEvent(speech.run, speechEventFromSpeechmatics({ message: 'AddTranscript',
          metadata: { transcript: `fragment${i}`, start_time: i * 0.2, end_time: i * 0.2 + 0.1 },
          results: [{ type: 'word', start_time: i * 0.2, end_time: i * 0.2 + 0.1, alternatives: [{ content: `fragment${i}`, confidence: 1 }] }],
        } as never, { speechRunId: speech.run, receivedAt: latencyNow(), receiptSequence: i, speechEventId: `continuous-${i}` })!);
        for (let tick = 0; tick < 20 && live!.runtime.replay.checkpoints.length <= i; tick++) await new Promise<void>(r => setImmediate(r));
      });
      expect(live!.runtime.replay.checkpoints).toHaveLength(i + 1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
        for (let tick = 0; tick < 20; tick++) await new Promise<void>(r => setImmediate(r));
      });
      const transcript = assembly.mock.results.at(-1)!.value.state;
      expect(transcript.spans).toHaveLength(1); expect(transcript.spans[0].status).toBe('open');
      if (i === 3) expect(live!.state.processedThroughSequence).toBe(4);
    }
    expect(live!.state.processedThroughSequence).toBe(8);
    expect(requests).toHaveLength(2); expect(legacyOpens).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
