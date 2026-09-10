import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Canvas, type CanvasEvidence } from '../canvas-spatial/Canvas.tsx';
import type { TraceEmitter } from '../trace/contracts.ts';
import type { AttentionPlan } from '../learner-projection/production.ts';
import { CoreProjector, type CoreProjectorSource } from './core-projector.ts';
import './core-teaching-surface.css';

export type CoreTeachingSurfaceProps = { source: CoreProjectorSource; attention?: AttentionPlan; onTrace?: TraceEmitter;
  onEvidence?(evidence: CanvasEvidence): void };

/** Shared production learner surface, fed only by already published Core state. */
export function CoreTeachingSurface(props: CoreTeachingSurfaceProps) {
  return <CoreSurfaceSession key={props.source.sessionId} {...props} />;
}
function CoreSurfaceSession({ source, attention, onTrace, onEvidence }: CoreTeachingSurfaceProps) {
  const callbacks = useRef({ onTrace, onEvidence });
  callbacks.current = { onTrace, onEvidence };
  const projector = useMemo(() => new CoreProjector(source, draft => callbacks.current.onTrace?.(draft), attention), [source]);
  const view = useSyncExternalStore(projector.subscribe, projector.getSnapshot);
  const [inspection, setInspection] = useState(false);
  const [follow, setFollow] = useState<typeof view.projection>();
  useLayoutEffect(() => { projector.setAttention(attention); }, [projector, attention]);
  const inspect = useCallback(() => { setInspection(true); setFollow(undefined); }, []);
  const rendered = useCallback((evidence: CanvasEvidence) => {
    projector.trace.record('core.projector', () => ({ knowledgeRevision: source.state.knowledge.revision,
      cueRevision: source.state.cue.revision, status: evidence.fits && !evidence.failedArtifactIds.length ? 'rendered' : 'degraded',
      ...(!evidence.fits ? { reason: 'automatic-zoom-floor' } : evidence.failedArtifactIds.length ? { reason: 'artifact-render-failed' } : {}), evidence }));
    try { callbacks.current.onEvidence?.(evidence); } catch { /* Diagnostics are independent. */ }
  }, [projector, source]);
  const failed = useCallback((reason: string) => {
    projector.trace.record('core.projector', () => ({ knowledgeRevision: source.state.knowledge.revision,
      cueRevision: source.state.cue.revision, status: 'degraded', reason }));
  }, [projector, source]);
  const projection = useMemo(() => follow === view.projection ? { ...view.projection, projector: 'REFRAME_ATTENTION' as const } : view.projection, [view.projection, follow]);
  const diagnostics = [...view.production.diagnostics, ...view.diagnostics];
  return <section className="core-teaching-surface" data-domain="core" data-knowledge-revision={view.state.knowledge.revision} aria-label="Live Core teaching surface">
    <Canvas runtime={view.runtime} state={view.state} registry={projector.registry} projection={projection}
      inspection={inspection} onInspect={inspect} onEvidence={rendered} onFailure={failed} />
    {diagnostics.length > 0 && <p className="core-surface-status" role="alert">Teaching visuals unavailable. Accepted lesson content is preserved.</p>}
    {(inspection || (view.projection.projector === 'PRESERVE_VIEW' && follow !== view.projection)) && <button className="core-follow" type="button" onClick={() => { setInspection(false); setFollow(view.projection); }}>Follow teaching</button>}
  </section>;
}
