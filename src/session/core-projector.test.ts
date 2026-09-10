import { afterEach, expect, it } from 'vitest';
import { CoreLiveSession } from '../lesson-stream/core/live-session.ts';
import { MemoryCoreStore, deferred } from '../lesson-stream/core/live-test-fixtures.ts';
import { replayCoreEvents } from '../lesson-stream/core/replay.ts';
import { INITIAL, REVISED, WITHDRAW, OTHER, RETURN, closedSpan, reviewInterpreter, reviewContext } from '../dev/core-projector/scenario.ts';
import { CoreProjector } from './core-projector.ts';
import { productionProducer, productionRegistry } from './representation-composition.ts';
import { produceRepresentations } from '../teaching-representation/producer.ts';
import { emptyArtifactRuntime, reconcileArtifacts } from '../teaching-representation/artifact-runtime.ts';
import { representationIdentity } from '../teaching-representation/identity.ts';
import { assignSpace } from '../learner-projection/space-assignment.ts';
import { CapabilityRegistry } from '../teaching-representation/registry.ts';
import type { SessionTraceDraft } from '../trace/contracts.ts';

const sessions: CoreLiveSession[] = [];
afterEach(() => { sessions.splice(0).forEach(session => session.close()); });
async function setup(id = 'production-projector') {
  const store = new MemoryCoreStore(), traces: SessionTraceDraft[] = [];
  const live = await CoreLiveSession.open({ sessionId: id, lessonDomain: 'core', speechRunId: 'review', store,
    interpreter: reviewInterpreter, contextOptions: reviewContext, trace: draft => traces.push(draft) });
  sessions.push(live);
  const projector = new CoreProjector(live.runtime, draft => traces.push(draft));
  const unsubscribe = projector.subscribe(() => undefined);
  return { live, store, projector, traces, unsubscribe };
}
async function accept(live: CoreLiveSession, text: string) {
  await live.commitClosedSpan(closedSpan(`span-${live.runtime.replay.checkpoints.length}`, text));
  await live.currentAttempt;
  expect(live.health.error).toBeUndefined();
}
function refs(live: CoreLiveSession) {
  const core = Object.values(live.state.knowledge.cores)[0];
  return Object.keys(core.objects).map(id => ({ kind: 'OBJECT' as const, coreId: core.id, id }));
}
function focus(projector: CoreProjector, targets: ReturnType<typeof refs>) {
  projector.setAttention({ attention: { anchor: targets[0], emphasis: targets, context: [], support: [] },
    transition: { knowledge: 'PRESERVE', framing: targets.length > 1 ? 'COMPARE' : 'FOCUS', representation: 'KEEP' },
    projector: 'REFRAME_ATTENTION', parkedCoreIds: [] });
}

it('publishes Core → candidates → M4A → canonical artifacts only after durable commit, with replay-equivalent truth', async () => {
  const { live, store, projector, traces } = await setup();
  const wait = deferred(), started = deferred();
  store.beforeAppend = async events => { if (events.some(e => e.type === 'core.step_accepted')) { started.resolve(); await wait.promise; } };
  await live.commitClosedSpan(closedSpan('initial', INITIAL)); await started.promise;
  expect(projector.getSnapshot().runtime.artifacts.size).toBe(0);
  wait.resolve(); await live.currentAttempt;
  const view = projector.getSnapshot();
  expect(view.production.candidates).toHaveLength(3);
  expect(view.projection.attention.representations).toHaveLength(1);
  expect(view.runtime.artifacts.size).toBe(1);
  expect(view.changes.map(c => c.action)).toEqual(['CREATE']);
  expect(replayCoreEvents(store.events).state).toEqual(view.state);
  expect(traces.map(t => t.type)).toEqual(expect.arrayContaining(['core.accepted', 'core.published', 'core.representation']));
  expect(traces.some(t => t.type.startsWith('board.'))).toBe(false);
  expect(new Set(store.events.map(e => e.schemaVersion))).toEqual(new Set(['lesson-event-v5-core']));
});
it('creates, updates, preserves, hides valid history, reselects it and withdraws stale content during PRESERVE_VIEW', async () => {
  const { live, projector } = await setup(); await accept(live, INITIAL);
  const targets = refs(live); focus(projector, targets.slice(0, 1));
  const initial = [...projector.getSnapshot().runtime.artifacts.values()].find(a => a.visible)!;
  await accept(live, REVISED);
  expect(projector.getSnapshot().runtime.artifacts.get(initial.id)).toMatchObject({ id: initial.id, revision: 2, visible: true });
  focus(projector, targets.slice(0, 1));
  expect(projector.getSnapshot().changes.find(c => c.id === initial.id)?.action).toBe('PRESERVE');
  focus(projector, targets.slice(1, 2));
  expect(projector.getSnapshot().runtime.artifacts.get(initial.id)?.visible).toBe(false);
  expect(projector.getSnapshot().changes.find(c => c.id === initial.id)?.action).toBe('WITHDRAW');
  focus(projector, targets.slice(0, 1));
  expect(projector.getSnapshot().runtime.artifacts.get(initial.id)?.revision).toBe(2);
  const old = projector.getSnapshot();
  projector.setAttention({ ...old.projection, projector: 'PRESERVE_VIEW' });
  await accept(live, WITHDRAW);
  expect(projector.getSnapshot().runtime.artifacts.has(initial.id)).toBe(false);
  expect(projector.getSnapshot().projection.projector).toBe('PRESERVE_VIEW');
  expect(live.state.knowledge.cores[targets[0].coreId].objects[targets[0].id].status).toBe('invalidated');
});
it('default attention follows accepted mainline changes and refocus without displaying parked history', async () => {
  const { live, projector } = await setup(); await accept(live, INITIAL);
  const original = live.state.knowledge.currentCoreId;
  await accept(live, OTHER);
  expect(projector.getSnapshot().projection.parkedCoreIds).toContain(original);
  await accept(live, RETURN);
  expect(live.state.knowledge.currentCoreId).toBe(original);
  expect(projector.getSnapshot().projection.attention.emphasis[0]).toMatchObject({ coreId: original });
});

it('production identity is collision-free, replay deterministic, revision stable and session/medium/purpose isolated', async () => {
  const { live } = await setup(); await accept(live, INITIAL);
  const target = refs(live)[0], input = { sessionId: live.state.sessionId, producerId: 'reviewed', capabilityId: 'accepted.content', kind: 'TEXT' as const, target, variant: 'literal' };
  const first = representationIdentity(input);
  await accept(live, REVISED);
  expect(representationIdentity(input)).toEqual(first);
  expect(representationIdentity(structuredClone(input))).toEqual(first);
  for (const patch of [{ sessionId: 'different' }, { capabilityId: 'accepted.equation', kind: 'MATH' as const }, { variant: 'separate-purpose' }, { producerId: 'other' }]) {
    expect(representationIdentity({ ...input, ...patch }).artifactId).not.toBe(first.artifactId);
  }
  expect(representationIdentity({ ...input, sessionId: 'a:b', producerId: 'c' })).not.toEqual(representationIdentity({ ...input, sessionId: 'a', producerId: 'b:c' }));
});
it('Space assignment is deterministic and stable across revision/refocus, and distinct units under one Core have distinct spaces', async () => {
  const { live } = await setup(); await accept(live, INITIAL);
  const targets = refs(live), initial = assignSpace(live.state, targets[0]);
  expect(assignSpace(structuredClone(live.state), targets[0])).toEqual(initial);
  expect(assignSpace(live.state, targets[1])).not.toEqual(initial);
  await accept(live, REVISED); expect(assignSpace(live.state, targets[0])).toEqual(initial);
  await accept(live, OTHER); await accept(live, RETURN); expect(assignSpace(live.state, targets[0])).toEqual(initial);
  expect(() => assignSpace(live.state, { kind: 'OBJECT', coreId: 'unknown', id: 'unknown' })).toThrow('space-target-invalid');
});
it.each(['malformed', 'capability', 'grounding', 'mutation'] as const)('isolates %s production failure from accepted truth and recovers', async failure => {
  const { live } = await setup(); await accept(live, INITIAL);
  const state = structuredClone(live.state), grounding = { checkpoints: live.runtime.replay.checkpoints };
  const base = productionProducer(refs(live)), registry = productionRegistry();
  const result = produceRepresentations(live.state, failure === 'grounding' ? { checkpoints: [] } : grounding,
    { ...base, propose(s, g) {
      if (failure === 'mutation') { (s.knowledge as { revision: number }).revision = 999; }
      const proposals = base.propose(s, g);
      return failure === 'malformed' ? [{ ...proposals[0], html: '<script />' }] : proposals;
    } }, failure === 'capability' ? new CapabilityRegistry() : registry);
  expect(result.candidates).toEqual([]); expect(result.diagnostics.length).toBeGreaterThan(0);
  expect(live.state).toEqual(state);
  expect(produceRepresentations(live.state, grounding, base, registry).diagnostics).toEqual([]);
});
it('diagnoses a selected candidate without payload and prevents identity rebinding even after withdrawal', async () => {
  const { live, projector } = await setup(); await accept(live, INITIAL);
  const view = projector.getSnapshot(), grounding = { checkpoints: live.runtime.replay.checkpoints }, registry = productionRegistry();
  const noPayload = { ...view.production, payloads: new Map() };
  const missing = reconcileArtifacts(emptyArtifactRuntime(live.state.sessionId), live.state, grounding, noPayload, view.projection, registry);
  expect(missing.diagnostics.join()).toContain('selected-payload-missing');
  const artifact = [...view.runtime.artifacts.values()][0];
  const withdrawn = { ...view.runtime, artifacts: new Map() };
  const changed = structuredClone(view.production);
  changed.payloads.get(artifact.payload.candidateId)!.producerId = 'different';
  const rebound = reconcileArtifacts(withdrawn, live.state, grounding, changed, view.projection, registry);
  expect(rebound.diagnostics.join()).toContain('artifact-identity-rebound');
  expect(rebound.runtime.artifacts.size).toBe(0);
});
it('revalidates retained payload grounding on reuse and isolates a failing diagnostic sink', async () => {
  const { live, projector } = await setup(); await accept(live, INITIAL);
  const view = projector.getSnapshot();
  const stale = reconcileArtifacts(view.runtime, live.state, { checkpoints: [] }, { ...view.production, candidates: [], payloads: new Map() }, view.projection, productionRegistry());
  expect(stale.runtime.artifacts.size).toBe(0); expect(stale.changes.every(c => c.action === 'WITHDRAW')).toBe(true);
  const badTrace = new CoreProjector(live.runtime, () => { throw new Error('trace'); });
  const stop = badTrace.subscribe(() => undefined);
  await accept(live, REVISED); expect(live.state.processedThroughSequence).toBe(2); stop();
});
it('executes complete M4A selection, transition, projector and parked IDs verbatim, including empty selection', async () => {
  const { live, projector } = await setup(); await accept(live, INITIAL);
  const projection = structuredClone(projector.getSnapshot().projection);
  projection.projector = 'PRESERVE_VIEW'; projection.transition.framing = 'WIDEN';
  projector.setAttention(projection);
  expect(projector.getSnapshot().projection).toEqual(projection);
  projection.attention.representations = [];
  projector.setAttention(structuredClone(projection));
  expect(projector.getSnapshot().production.candidates).toHaveLength(3);
  expect([...projector.getSnapshot().runtime.artifacts.values()].some(a => a.visible)).toBe(false);
  expect(projector.getSnapshot().projection).toEqual(projection);
});
