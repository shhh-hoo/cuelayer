import { Component, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { LearnerProjection } from '../learner-projection/contracts.ts';
import type { ArtifactRuntime } from '../teaching-representation/artifact-runtime.ts';
import { immutableCopy, type AcceptedTeachingState } from '../teaching-representation/contracts.ts';
import { referenceKey } from '../teaching-representation/grounding.ts';
import type { CapabilityRegistry } from '../teaching-representation/registry.ts';
import { artifactHomes, emptySpaces, updateSpaces, type SemanticSpaces } from './semantic-space.ts';
import { composePresentation, type PresentationGeometry } from './presentation.ts';
import { planMotion, sampleMotion, type MotionBoxes } from './motion.ts';
import type { Viewport } from './geometry.ts';
import './canvas.css';

export type CanvasEvidence = { spaces: SemanticSpaces; persistent: ReturnType<typeof artifactHomes>; temporary: PresentationGeometry['temporary'];
  rendered: MotionBoxes; visibleIds: string[]; failedArtifactIds: string[]; camera: Viewport; moving: boolean; motionSafe: boolean; fits: boolean; inspection: boolean };
export type CanvasProps = { runtime: ArtifactRuntime; state: AcceptedTeachingState; registry: CapabilityRegistry; projection: LearnerProjection;
  inspection: boolean; onInspect(): void; widthAdjustments?: Record<string, number>; onEvidence(evidence: CanvasEvidence): void;
  onFailure?(reason: string): void };
const origin: Viewport = { x: 0, y: 0, zoom: 1 };

class RenderBoundary extends Component<{ token: string; children: ReactNode; onFailure(reason: string): void }, { token: string; failed: boolean }> {
  state = { token: this.props.token, failed: false };
  static getDerivedStateFromProps(props: { token: string }, state: { token: string }) {
    return props.token !== state.token ? { token: props.token, failed: false } : null;
  }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onFailure(`representation-render-failed:${error.message}`); }
  render() { return this.state.failed ? null : this.props.children; }
}
function ArtifactContent({ registry, artifact, state, comparing }: { registry: CapabilityRegistry;
  artifact: import('../teaching-representation/artifact-runtime.ts').Artifact; state: AcceptedTeachingState; comparing: boolean }) {
  return registry.resolve(artifact.payload.capabilityId).render(artifact.payload.data, { state, comparing });
}

/** Subject-agnostic measured host. Capabilities own content; this component owns
 * canonical mounting, space packing, temporary motion and shared camera only. */
export function Canvas({ runtime, state, registry, projection, inspection, onInspect, widthAdjustments, onEvidence, onFailure }: CanvasProps) {
  const surface = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const spaces = useRef(emptySpaces(runtime.sessionId));
  const rendered = useRef<MotionBoxes>({});
  const camera = useRef(origin);
  const latest = useRef<CanvasEvidence | undefined>(undefined);
  const callbacks = useRef({ onEvidence, onFailure });
  callbacks.current = { onEvidence, onFailure };
  const [geometry, setGeometry] = useState<MotionBoxes>({});
  const [viewport, setViewport] = useState(origin);
  const [moving, setMoving] = useState(false);
  const [failure, setFailure] = useState('');
  const [measurementRevision, setMeasurementRevision] = useState(0);
  const [renderFailures, setRenderFailures] = useState<Record<string, string>>({});
  const measured = useRef(new WeakMap<Element, string>());
  const snapshot = useMemo(() => immutableCopy(state), [state]);
  const artifacts = [...runtime.artifacts.values()];
  const comparing = projection.transition.framing === 'COMPARE';
  const token = `${state.sessionId}:${state.knowledge.revision}:${state.cue.revision}`;

  useLayoutEffect(() => {
    const observer = new ResizeObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const size = `${element.offsetWidth}:${element.offsetHeight}`;
        if (measured.current.get(element) !== size) { measured.current.set(element, size); changed = true; }
      }
      // ResizeObserver runs before paint. Settle pressure before exposing resized
      // content; dimensions are deduplicated and transforms do not invalidate it.
      if (changed) flushSync(() => setMeasurementRevision(n => n + 1));
    });
    observer.observe(surface.current!);
    for (const element of elements.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [runtime]);
  useLayoutEffect(() => {
    let animation = 0;
    try {
      const size = { width: surface.current!.clientWidth, height: surface.current!.clientHeight };
      if (!size.width || !size.height) return;
      if (spaces.current.sessionId !== runtime.sessionId) { spaces.current = emptySpaces(runtime.sessionId); rendered.current = {}; }
      const members = [...runtime.artifacts.values()].filter(a => renderFailures[a.id] !== token).map(artifact => {
        const element = elements.current.get(artifact.id);
        if (!element) throw new Error(`artifact-not-mounted:${artifact.id}`);
        if (!element.hasChildNodes()) throw new Error(`artifact-render-empty:${artifact.id}`);
        return { id: artifact.id, group: `${referenceKey(artifact.payload.space.anchor)}:${artifact.payload.space.key}`,
          size: { width: element.offsetWidth, height: element.offsetHeight } };
      });
      spaces.current = updateSpaces(spaces.current, members);
      const persistent = artifactHomes(spaces.current);
      const selected = projection.attention.representations.flatMap(intent => {
        const artifact = [...runtime.artifacts.values()].find(a => a.visible && a.payload.candidateId === intent.id);
        return artifact && persistent[artifact.id] ? [artifact.id] : [];
      });
      const frame = composePresentation(persistent, selected, projection, size);
      const to: MotionBoxes = Object.fromEntries(Object.entries(frame.boxes).map(([id, box]) => [id, { ...box, presentation: Boolean(frame.temporary[id]) }]));
      const motion = planMotion(rendered.current, to, selected);
      const oldCamera = camera.current;
      const targetCamera = inspection || projection.projector === 'PRESERVE_VIEW' ? oldCamera : frame.camera;
      const resized = selected.some(id => rendered.current[id] && (rendered.current[id].width !== to[id].width || rendered.current[id].height !== to[id].height));
      // Content resize settles atomically; only verified fixed-size travel is animated.
      const animate = !resized && !inspection && motion.safe && Object.keys(rendered.current).length > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const started = performance.now();
      const tick = (now: number) => {
        const t = animate ? Math.min(1, (now - started) / 320) : 1;
        const boxes = sampleMotion(motion, t);
        const nextCamera = { x: oldCamera.x + (targetCamera.x - oldCamera.x) * t, y: oldCamera.y + (targetCamera.y - oldCamera.y) * t,
          zoom: oldCamera.zoom + (targetCamera.zoom - oldCamera.zoom) * t };
        rendered.current = boxes; camera.current = nextCamera;
        setGeometry(boxes); setViewport(nextCamera); setMoving(t < 1);
        const evidence: CanvasEvidence = { spaces: spaces.current, persistent, temporary: frame.temporary, rendered: boxes, camera: nextCamera,
          visibleIds: selected, failedArtifactIds: Object.keys(renderFailures).filter(id => renderFailures[id] === token),
          moving: t < 1, motionSafe: motion.safe, fits: frame.fits, inspection };
        latest.current = evidence;
        if (t < 1) animation = requestAnimationFrame(tick); else { try { callbacks.current.onEvidence(evidence); } catch { /* Diagnostic only. */ } }
      };
      setFailure(''); tick(started);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setFailure(reason); setGeometry({}); setMoving(false); try { callbacks.current.onFailure?.(reason); } catch { /* Diagnostic only. */ }
    }
    return () => cancelAnimationFrame(animation);
  }, [runtime, snapshot, projection, registry, inspection, widthAdjustments, measurementRevision, renderFailures, token]);

  const inspectCamera = (next: Viewport) => {
    onInspect(); camera.current = next; setViewport(next);
    if (latest.current) { try { onEvidence({ ...latest.current, camera: next, inspection: true }); } catch { /* Diagnostic only. */ } }
  };
  const drag = useRef<{ x: number; y: number; camera: Viewport } | undefined>(undefined);
  return <div className="representation-canvas" ref={surface} aria-label="Shared learner projector" data-moving={moving} data-inspection={inspection}
    onWheel={event => { const zoom = Math.max(0.3, Math.min(1.5, camera.current.zoom * (event.deltaY > 0 ? 0.9 : 1.1))); inspectCamera({ ...camera.current, zoom }); }}
    onPointerDown={event => { if (event.button !== 0) return; drag.current = { x: event.clientX, y: event.clientY, camera: camera.current }; event.currentTarget.setPointerCapture(event.pointerId); onInspect(); }}
    onPointerMove={event => { if (drag.current) inspectCamera({ ...drag.current.camera, x: drag.current.camera.x + event.clientX - drag.current.x, y: drag.current.camera.y + event.clientY - drag.current.y }); }}
    onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}>
    {(failure || Object.values(renderFailures).includes(token)) && <p className="canvas-status" role="alert">Visual unavailable. Accepted lesson content is preserved.</p>}
    {!failure && latest.current?.fits === false && <p className="canvas-status" role="status">This view exceeds automatic fit. Pan or zoom to inspect it.</p>}
    <div className="canvas-world" style={{ visibility: failure ? 'hidden' : undefined, transform: `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.zoom})` }}>
      {artifacts.map(artifact => {
        let preferredWidth = 470;
        try { preferredWidth = registry.resolve(artifact.payload.capabilityId).preferredWidth; } catch { /* Boundary below reports missing implementation. */ }
        const box = geometry[artifact.id];
        const visible = artifact.visible && Boolean(box) && renderFailures[artifact.id] !== token;
        return <article key={artifact.id} ref={element => { if (element) elements.current.set(artifact.id, element); else elements.current.delete(artifact.id); }}
          className="representation-artifact" data-artifact-id={artifact.id} data-capability-id={artifact.payload.capabilityId} data-revision={artifact.revision}
          data-visible={visible} data-role={artifact.role} aria-hidden={!visible}
          style={{ width: preferredWidth + (widthAdjustments?.[artifact.id] ?? 0), left: box?.x ?? 0, top: box?.y ?? 0,
            visibility: visible ? 'visible' : 'hidden' }}>
          <RenderBoundary token={token} onFailure={reason => {
            setRenderFailures(old => ({ ...old, [artifact.id]: token }));
            try { onFailure?.(`${artifact.id}:${reason}`); } catch { /* Diagnostic only. */ }
          }}><ArtifactContent registry={registry} artifact={artifact} state={snapshot} comparing={comparing} /></RenderBoundary>
        </article>;
      })}
    </div>
  </div>;
}
