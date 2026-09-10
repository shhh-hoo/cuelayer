// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Canvas, type CanvasEvidence, type CanvasProps } from './Canvas.tsx';
import * as packing from './semantic-space.ts';
import { overlaps } from './geometry.ts';
import { CoreLiveSession } from '../lesson-stream/core/live-session.ts';
import { MemoryCoreStore } from '../lesson-stream/core/live-test-fixtures.ts';
import { INITIAL, REVISED, WITHDRAW, closedSpan, reviewContext, reviewInterpreter } from '../dev/core-projector/scenario.ts';
import { CoreProjector } from '../session/core-projector.ts';
import { CoreTeachingSurface } from '../session/CoreTeachingSurface.tsx';
import { PresentationStage } from '../session/PresentationStage.tsx';
import { LessonStreamRuntime } from '../lesson-stream/runtime.ts';
import { CapabilityRegistry } from '../teaching-representation/registry.ts';
import { acceptedTextCapability } from '../representation-capabilities/accepted-text.tsx';

let root: Root, host: HTMLDivElement, live: CoreLiveSession, projector: CoreProjector;
let evidence: CanvasEvidence, failures: string[], props: CanvasProps;
let surfaceWidth = 1280, surfaceHeight = 620;
const dimensions = new WeakMap<HTMLElement, { width: number; height: number }>();
class Observer {
  static all = new Set<Observer>();
  elements = new Set<Element>();
  constructor(readonly callback: ResizeObserverCallback) { Observer.all.add(this); }
  observe(element: Element) { this.elements.add(element); }
  disconnect() { Observer.all.delete(this); }
  unobserve(element: Element) { this.elements.delete(element); }
  static resize(element: Element) {
    for (const observer of [...Observer.all]) if (observer.elements.has(element)) observer.callback([{ target: element } as ResizeObserverEntry], observer as unknown as ResizeObserver);
  }
}
beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', Observer);
  vi.stubGlobal('requestAnimationFrame', vi.fn()); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  surfaceWidth = 1280; surfaceHeight = 620;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function(this: HTMLElement) { return surfaceWidth; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function(this: HTMLElement) { return surfaceHeight; });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function(this: HTMLElement) { return dimensions.get(this)?.width ?? (this.classList.contains('representation-artifact') ? 470 : surfaceWidth); });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function(this: HTMLElement) { return dimensions.get(this)?.height ?? (this.classList.contains('representation-artifact') ? 200 : surfaceHeight); });
  live = await CoreLiveSession.open({ sessionId: 'dom-projector', lessonDomain: 'core', speechRunId: 'review', store: new MemoryCoreStore(), interpreter: reviewInterpreter, contextOptions: reviewContext });
  await live.commitClosedSpan(closedSpan('initial', INITIAL)); await live.currentAttempt;
  projector = new CoreProjector(live.runtime); projector.subscribe(() => undefined);
  const core = Object.values(live.state.knowledge.cores)[0];
  const refs = Object.keys(core.objects).map(id => ({ kind: 'OBJECT' as const, coreId: core.id, id }));
  projector.setAttention({ attention: { anchor: refs[0], emphasis: refs, context: [], support: [] },
    transition: { knowledge: 'PRESERVE', framing: 'FOCUS', representation: 'KEEP' }, projector: 'REFRAME_ATTENTION', parkedCoreIds: [] });
  failures = [];
  props = { runtime: projector.getSnapshot().runtime, state: live.state, registry: projector.registry, projection: projector.getSnapshot().projection,
    inspection: false, onInspect: () => undefined, onEvidence: value => { evidence = value; }, onFailure: reason => failures.push(reason) };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(() => root.unmount()); live.close(); host.remove(); Observer.all.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(update: Partial<CanvasProps> = {}) { props = { ...props, ...update }; await act(() => root.render(<Canvas {...props} />)); }
const articles = () => [...host.querySelectorAll<HTMLElement>('[data-artifact-id]')];
async function accept(text: string) { await act(async () => { await live.commitClosedSpan(closedSpan(`s-${live.state.processedThroughSequence}`, text)); await live.currentAttempt; }); expect(live.health.error).toBeUndefined(); }

it('observes internal artifact resizing, moves the neighbor by exactly 120px, preserves distant space and deduplicates observer delivery', async () => {
  await render();
  const [a, b, c] = articles(), initial = structuredClone(evidence);
  // Give the distant space a measured gap, without changing Canvas dimensions.
  dimensions.set(b, { width: 100, height: 200 }); await act(() => Observer.resize(b));
  const before = structuredClone(evidence), revision = live.state.knowledge.revision;
  dimensions.set(a, { width: 590, height: 200 }); await act(() => Observer.resize(a));
  expect(evidence.persistent[b.dataset.artifactId!].x - before.persistent[b.dataset.artifactId!].x).toBe(120);
  expect(evidence.persistent[c.dataset.artifactId!]).toEqual(before.persistent[c.dataset.artifactId!]);
  expect(live.state.knowledge.revision).toBe(revision);
  expect(evidence.spaces.spaces[0].localBounds.width - initial.spaces.spaces[0].localBounds.width).toBe(120);
  const after = evidence; await act(() => Observer.resize(a)); expect(evidence).toBe(after);
  for (const space of evidence.spaces.spaces) for (const other of evidence.spaces.spaces) if (space !== other) expect(overlaps(packing.spaceBounds(space), packing.spaceBounds(other), 47.999)).toBe(false);
  expect(articles()).toEqual([a, b, c]); expect(failures).toEqual([]);
});
it('COMPARE/WIDEN reuse mounted canonical artifacts and restore unchanged persistent geography', async () => {
  await render(); const nodes = articles(), homes = structuredClone(evidence.persistent);
  for (const framing of ['COMPARE', 'WIDEN', 'FOCUS'] as const) {
    await render({ projection: { ...props.projection, transition: { ...props.projection.transition, framing } } });
    expect(evidence.persistent).toEqual(homes); expect(articles()).toEqual(nodes);
    expect(Object.keys(evidence.temporary).length).toBe(framing === 'FOCUS' ? 0 : 3);
  }
});
it('shared production stage exclusively mounts Core, continues revision and stale withdrawal during inspection, then follows latest attention', async () => {
  const legacy = vi.spyOn(LessonStreamRuntime, 'open');
  const plan = projector.getSnapshot().projection;
  const onEvidence = (value: CanvasEvidence) => { evidence = value; };
  await act(() => root.render(<PresentationStage stream={null} presentationStatus="empty" sessionStatus="active" speech={{ finals: [], spans: [] }} speechStatus="off" showSpeechDebug={false}
    coreTeaching={{ source: live.runtime, attention: plan, onEvidence }} />));
  const nodes = articles(), first = nodes.find(node => node.textContent?.includes("Reservoir A"))!;
  await act(() => host.querySelector('.representation-canvas')!.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 })));
  const camera = { ...evidence.camera }; expect(evidence.inspection).toBe(true);
  await accept(REVISED);
  expect(first.textContent).toContain(REVISED); expect(articles()).toContain(first); expect(evidence.camera).toEqual(camera);
  await accept(WITHDRAW);
  expect(first.isConnected).toBe(false); expect(host.textContent).not.toContain(REVISED); expect(evidence.camera).toEqual(camera);
  await act(() => host.querySelector<HTMLButtonElement>('.core-follow')!.click());
  expect(evidence.inspection).toBe(false); expect(evidence.camera).not.toEqual(camera);
  expect(host.querySelector('[data-board-item-id]')).toBeNull(); expect(legacy).not.toHaveBeenCalled();
});
it('PRESERVE_VIEW also freezes automatic camera; Follow teaching executes the latest framing', async () => {
  const plan = { ...projector.getSnapshot().projection, projector: 'PRESERVE_VIEW' as const };
  const onEvidence = (value: CanvasEvidence) => { evidence = value; };
  await act(() => root.render(<CoreTeachingSurface source={live.runtime} attention={plan} onEvidence={onEvidence} />));
  expect(evidence.camera).toEqual({ x: 0, y: 0, zoom: 1 });
  await act(() => host.querySelector<HTMLButtonElement>('.core-follow')!.click());
  expect(evidence.camera).not.toEqual({ x: 0, y: 0, zoom: 1 });
});
it.each(['measurement', 'pressure'] as const)('fails closed on invalid %s without publishing overlap and recovers', async kind => {
  await render(); const state = structuredClone(live.state), node = articles()[0];
  if (kind === 'measurement') dimensions.set(node, { width: 0, height: 200 });
  const pressure = kind === 'pressure' ? vi.spyOn(packing, 'updateSpaces').mockImplementationOnce(() => { throw new Error('space-pressure-unresolved'); }) : undefined;
  await act(() => Observer.resize(node));
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(articles().every(node => node.style.visibility === 'hidden')).toBe(true);
  expect(failures.join()).toContain(kind === 'measurement' ? 'invalid-measurement' : 'space-pressure-unresolved');
  expect(live.state).toEqual(state);
  pressure?.mockRestore(); dimensions.set(node, { width: 471, height: 200 }); await act(() => Observer.resize(node));
  expect(host.querySelector('[role="alert"]')).toBeNull(); expect(articles().every(node => node.style.visibility === 'visible')).toBe(true);
});
it('isolates a capability render exception, withdraws its DOM, and retries on a future accepted revision', async () => {
  let broken = true;
  const registry = new CapabilityRegistry().register({ ...acceptedTextCapability, render(data, context) {
    if (broken) throw new Error('synthetic-render-failure'); return acceptedTextCapability.render(data, context);
  } });
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await render({ registry });
  expect(host.textContent).not.toContain('Reservoir A'); expect(failures.join()).toContain('representation-render-failed');
  broken = false; await accept(REVISED);
  await render({ state: live.state, runtime: projector.getSnapshot().runtime });
  expect(host.textContent).toContain(REVISED); expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(consoleError).toHaveBeenCalled();
});
it('reports automatic zoom floor and wraps temporary composition on narrow viewports without changing homes', async () => {
  surfaceWidth = 390; surfaceHeight = 700;
  await render({ projection: { ...props.projection, attention: { ...props.projection.attention, representations: props.projection.attention.representations.slice(0, 2) }, transition: { ...props.projection.transition, framing: 'COMPARE' } } });
  const boxes = Object.values(evidence.temporary);
  expect(boxes[1].y).toBeGreaterThan(boxes[0].y + boxes[0].height); expect(evidence.fits).toBe(true);
  const selectedId = [...props.runtime.artifacts.values()].find(a => a.payload.candidateId === props.projection.attention.representations[0].id)!.id;
  const selected = articles().find(node => node.dataset.artifactId === selectedId)!;
  dimensions.set(selected, { width: 2000, height: 200 }); await act(() => Observer.resize(selected));
  expect(evidence.fits).toBe(false); expect(evidence.camera.zoom).toBe(0.65);
  expect(host.querySelector('[role="status"]')?.textContent).toContain('automatic fit');
});
it('fails closed when a renderer cannot mount any content, then recovers with a valid implementation', async () => {
  await render({ registry: new CapabilityRegistry().register({ ...acceptedTextCapability, render: () => null }) });
  expect(failures.join()).toContain('artifact-render-empty');
  expect(articles().every(node => node.style.visibility === 'hidden')).toBe(true);
  await render({ registry: projector.registry });
  expect(host.querySelector('[role="alert"]')).toBeNull(); expect(host.textContent).toContain('Reservoir A');
});
it('does not reset canonical history when diagnostic callbacks change identity', async () => {
  const plan = projector.getSnapshot().projection;
  await act(() => root.render(<CoreTeachingSurface source={live.runtime} attention={plan} onTrace={() => undefined} />));
  await accept(REVISED);
  const node = articles().find(n => n.textContent?.includes('Reservoir A'))!;
  expect(node.dataset.revision).toBe('2');
  await act(() => root.render(<CoreTeachingSurface source={live.runtime} attention={plan} onTrace={() => undefined} />));
  expect(articles()).toContain(node); expect(node.dataset.revision).toBe('2');
});

it('diagnostic observer exceptions cannot hide valid artifacts', async () => {
  await render({ onEvidence: () => { throw new Error('diagnostic-only'); } });
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(articles().every(node => node.style.visibility === 'visible')).toBe(true);
  expect(failures).toEqual([]);
});
