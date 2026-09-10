import { useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  rendered: MotionBoxes; camera: Viewport; moving: boolean; motionSafe: boolean; fits: boolean; inspection: boolean };
export type CanvasProps = { runtime: ArtifactRuntime; state: AcceptedTeachingState; registry: CapabilityRegistry; projection: LearnerProjection;
  inspection: boolean; onInspect(): void; widthAdjustments?: Record<string, number>; onEvidence(evidence: CanvasEvidence): void };
const origin: Viewport = { x: 0, y: 0, zoom: 1 };

/** Subject-agnostic measured host. Capabilities own content; this component owns
 * canonical mounting, space packing, temporary motion and shared camera only. */
export function Canvas({ runtime, state, registry, projection, inspection, onInspect, widthAdjustments, onEvidence }: CanvasProps) {
  const surface = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const spaces = useRef(emptySpaces(runtime.sessionId));
  const rendered = useRef<MotionBoxes>({});
  const camera = useRef(origin);
  const latest = useRef<CanvasEvidence | undefined>(undefined);
  const [geometry, setGeometry] = useState<MotionBoxes>({});
  const [viewport, setViewport] = useState(origin);
  const [moving, setMoving] = useState(false);
  const [failure, setFailure] = useState('');
  const [measurementRevision, setMeasurementRevision] = useState(0);
  const snapshot = useMemo(() => immutableCopy(state), [state]);
  const artifacts = [...runtime.artifacts.values()];
  const comparing = projection.transition.framing === 'COMPARE';

  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => setMeasurementRevision(n => n + 1));
    observer.observe(surface.current!);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    let animation = 0;
    try {
      const size = { width: surface.current!.clientWidth, height: surface.current!.clientHeight };
      if (!size.width || !size.height) return;
      if (spaces.current.sessionId !== runtime.sessionId) { spaces.current = emptySpaces(runtime.sessionId); rendered.current = {}; }
      const members = [...runtime.artifacts.values()].map(artifact => {
        const element = elements.current.get(artifact.id)!;
        return { id: artifact.id, group: `${referenceKey(artifact.payload.space.anchor)}:${artifact.payload.space.key}`,
          size: { width: element.offsetWidth, height: element.offsetHeight } };
      });
      spaces.current = updateSpaces(spaces.current, members);
      const persistent = artifactHomes(spaces.current);
      const selected = projection.attention.representations.flatMap(intent => {
        const artifact = [...runtime.artifacts.values()].find(a => a.visible && a.payload.candidateId === intent.id);
        return artifact ? [artifact.id] : [];
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
          moving: t < 1, motionSafe: motion.safe, fits: frame.fits, inspection };
        latest.current = evidence;
        if (t < 1) animation = requestAnimationFrame(tick); else onEvidence(evidence);
      };
      setFailure(''); tick(started);
    } catch (error) { setFailure(error instanceof Error ? error.message : String(error)); }
    return () => cancelAnimationFrame(animation);
  }, [runtime, snapshot, projection, registry, inspection, widthAdjustments, measurementRevision, onEvidence]);

  const inspectCamera = (next: Viewport) => {
    onInspect(); camera.current = next; setViewport(next);
    if (latest.current) onEvidence({ ...latest.current, camera: next, inspection: true });
  };
  const drag = useRef<{ x: number; y: number; camera: Viewport } | undefined>(undefined);
  return <div className="representation-canvas" ref={surface} aria-label="Shared learner projector" data-moving={moving} data-inspection={inspection}
    onWheel={event => { const zoom = Math.max(0.3, Math.min(1.5, camera.current.zoom * (event.deltaY > 0 ? 0.9 : 1.1))); inspectCamera({ ...camera.current, zoom }); }}
    onPointerDown={event => { if (event.button !== 0) return; drag.current = { x: event.clientX, y: event.clientY, camera: camera.current }; event.currentTarget.setPointerCapture(event.pointerId); onInspect(); }}
    onPointerMove={event => { if (drag.current) inspectCamera({ ...drag.current.camera, x: drag.current.camera.x + event.clientX - drag.current.x, y: drag.current.camera.y + event.clientY - drag.current.y }); }}
    onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}>
    {failure && <p role="alert">Canvas unavailable: {failure}</p>}
    <div className="canvas-world" style={{ transform: `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.zoom})` }}>
      {artifacts.map(artifact => {
        const capability = registry.resolve(artifact.payload.capabilityId), box = geometry[artifact.id];
        return <article key={artifact.id} ref={element => { if (element) elements.current.set(artifact.id, element); else elements.current.delete(artifact.id); }}
          className="representation-artifact" data-artifact-id={artifact.id} data-capability-id={artifact.payload.capabilityId} data-revision={artifact.revision}
          data-visible={artifact.visible} data-role={artifact.role} aria-hidden={!artifact.visible || !box}
          style={{ width: capability.preferredWidth + (widthAdjustments?.[artifact.id] ?? 0), left: box?.x ?? 0, top: box?.y ?? 0,
            visibility: artifact.visible && box ? 'visible' : 'hidden' }}>
          {capability.render(artifact.payload.data, { state: snapshot, comparing })}
        </article>;
      })}
    </div>
  </div>;
}
