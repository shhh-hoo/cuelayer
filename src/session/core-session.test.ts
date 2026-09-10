import { afterEach, expect, it, vi } from 'vitest';
import { openCoreSession } from './core-session';
import { MemoryCoreStore, closedSpan, deferred, proposalFor, addCue } from '../lesson-stream/core/live-test-fixtures';
import { buildCoreInterpretationContext } from '../lesson-stream/core/interpretation-context';
import type { CoreLiveSession } from '../lesson-stream/core/live-session';
import { CoreProjector } from './core-projector';
let live: CoreLiveSession;
afterEach(() => live?.close());
it('trace and verification-side failures cannot roll back Core acceptance or reset the artifact lifecycle', async () => {
  const store = new MemoryCoreStore();
  live = await openCoreSession({ sessionId: 'side-failure', speechRunId: 0, store,
    interpreter: async binding => proposalFor(binding, true, true), trace: () => { throw Error('trace-failed'); },
    verificationSink: async () => { throw Error('verification-failed'); } });
  const projector = new CoreProjector(live.runtime, () => { throw Error('visual-trace-failed'); });
  const unsubscribe = projector.subscribe(() => undefined);
  await live.commitClosedSpan(closedSpan('one')); await live.currentAttempt;
  const firstIds = [...projector.getSnapshot().runtime.artifacts.keys()];
  await new Promise(r => setTimeout(r, 10));
  await live.commitClosedSpan(closedSpan('two')); await live.currentAttempt;
  expect(live.state.processedThroughSequence).toBe(2); expect(live.health.pendingCount).toBe(0);
  expect([...projector.getSnapshot().runtime.artifacts.keys()]).toEqual(expect.arrayContaining(firstIds));
  expect(await live.finalize()).toBe(true); unsubscribe();
});
it('incomplete finalization remains unended, replayable and explicitly retryable', async () => {
  const store = new MemoryCoreStore();
  live = await openCoreSession({ sessionId: 'incomplete', speechRunId: 0, store, finalizationMs: 1,
    interpreter: async () => { throw Error('unavailable'); } });
  await live.commitClosedSpan(closedSpan()); await live.currentAttempt;
  expect(await live.finalize()).toBe(false);
  expect(store.events.some(e => e.type === 'lesson.ended')).toBe(false);
  live.close();
  live = await openCoreSession({ sessionId: 'incomplete', speechRunId: 0, store, interpreter: async binding => proposalFor(binding, true) });
  await live.currentAttempt;
  expect(await live.finalize()).toBe(true); expect(live.state.processedThroughSequence).toBe(1);
  expect(store.events.filter(e => e.type === 'core.step_accepted')).toHaveLength(1);
});
it('production composition cannot let a stale result overwrite competing accepted truth', async () => {
  const store = new MemoryCoreStore();
  let reply = deferred<unknown>();
  live = await openCoreSession({ sessionId: 'conflict', speechRunId: 0, store, interpreter: () => reply.promise });
  await live.commitClosedSpan(closedSpan());
  const binding = buildCoreInterpretationContext(live.runtime.replay, { requestId: 'competing', newEvidence: live.runtime.pending });
  // A competing acceptance consumes the prefix. The stale flight cannot consume it again.
  await live.runtime.acceptProposal(binding, addCue(proposalFor(binding, true)));
  const accepted = structuredClone(live.state);
  reply.resolve(proposalFor(binding, true)); await live.currentAttempt;
  expect(live.state).toEqual(accepted); expect(live.health.pendingCount).toBe(0);
  expect(store.events.filter(e => e.type === 'core.step_accepted')).toHaveLength(1);
});
