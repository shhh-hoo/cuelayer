import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { LocalLessonEventStore } from '../lesson-stream/store';
import { lessonStartedEvent, speechRunAllocatedEvent } from '../lesson-stream/events';
import { LessonStreamRuntime } from '../lesson-stream/runtime';
import { openCoreSession } from './core-session';

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange); });
afterEach(() => vi.unstubAllGlobals());
const resolve = LocalLessonEventStore.resolveDomain;
async function seed(claim: unknown, events: unknown[] = []) {
  const request = indexedDB.open('cuelayer-lesson-stream-v1', 2);
  await new Promise<void>((yes, no) => {
    request.onupgradeneeded = () => {
      request.result.createObjectStore('lesson-domains', { keyPath: 'sessionId' });
      const store = request.result.createObjectStore('lesson-events', { keyPath: 'eventId' });
      store.createIndex('session-sequence', ['sessionId', 'sequence', 'eventId']);
    };
    request.onsuccess = () => yes(); request.onerror = () => no(request.error);
  });
  const tx = request.result.transaction(['lesson-domains', 'lesson-events'], 'readwrite');
  if (claim !== undefined) tx.objectStore('lesson-domains').add(claim);
  events.forEach(event => tx.objectStore('lesson-events').add(event));
  await new Promise<void>((yes, no) => { tx.oncomplete = () => yes(); tx.onerror = () => no(tx.error); });
  request.result.close();
}
it('durably claims an empty new session as Core before runtime creation', async () => {
  expect(await resolve('new', { create: true })).toBe('core');
  expect(await resolve('new', { create: false })).toBe('core');
  await expect(LessonStreamRuntime.open('new')).rejects.toThrow('lesson-domain-mismatch');
});
it.each(['core', 'legacy'] as const)('stored %s cannot be changed by a requested domain or creation flag', async domain => {
  await seed({ sessionId: 'stored', domain });
  await expect(resolve('stored', { create: true, requestedDomain: domain === 'core' ? 'legacy' : 'core' })).rejects.toThrow('lesson-domain-mismatch');
  expect(await resolve('stored', { create: false })).toBe(domain);
});
it('unknown reopen identity fails without guessing a domain', async () => {
  await expect(resolve('missing', { create: false })).rejects.toThrow('lesson-domain-missing');
});
it.each([null, 'broken', undefined])('invalid durable claim fails closed (%s)', async domain => {
  await seed({ sessionId: 'bad', domain });
  await expect(resolve('bad', { create: true })).rejects.toThrow('lesson-domain-invalid');
});
it('missing Core claim and mixed generations fail instead of being repaired', async () => {
  const legacy = lessonStartedEvent('bad', 1);
  await seed(undefined, [{ ...legacy, schemaVersion: 'lesson-event-v5-core' }]);
  await expect(resolve('bad', { create: false })).rejects.toThrow('lesson-domain-mismatch');
});
it.each(['lesson-event-v3-learner-agency', 'lesson-event-v4-continuous'] as const)('preserves historical %s and valid mixed v3/v4 envelopes', async schemaVersion => {
  const events = [{ ...lessonStartedEvent('history', 1), schemaVersion }, speechRunAllocatedEvent('history', 2, 'old-run')];
  await seed(undefined, events);
  expect(await resolve('history', { create: false })).toBe('legacy');
  const runtime = await LessonStreamRuntime.open('history');
  expect(runtime.events).toEqual(events); runtime.close();
  await expect(openCoreSession({ sessionId: 'history', speechRunId: 0, interpreter: vi.fn() })).rejects.toThrow('lesson-domain-mismatch');
});
it('a stored claim with mismatched event generation fails before either runtime opens', async () => {
  await seed({ sessionId: 'bad', domain: 'core' }, [lessonStartedEvent('bad', 1)]);
  await expect(resolve('bad', { create: false })).rejects.toThrow('lesson-domain-mismatch');
});
