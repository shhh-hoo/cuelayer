import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlow, ReactFlowProvider, ViewportPortal, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { LearnerProjection } from '../../learner-projection/contracts.ts';
import { emptyHomes, type HomeGeometry, type TeachingFrame } from '../m4b-choreography/model.ts';
import { planMotion, sampleMotion, type MotionBoxes } from '../m4b-choreography/motion.ts';
import { routeRelation } from '../m4b-choreography/relations.ts';
import { visualLayer } from '../m4b-choreography/presentation.ts';
import { cameraFor, canvasCatalog, establishHomes, plotAttachment, presentationPositions, visualId, type Visual } from './canvas-model.ts';
import type { LessonStep } from './lesson.ts';
import type { Production } from './producer.ts';
import { EnergyProfile, Equation } from './Primitives.tsx';
import { FunctionPlot, TrigEquation } from './TrigPrimitives.tsx';

type VisualData = Visual & { step: LessonStep; suppressed: boolean; presentation: boolean };
function VisualContent({ data }: { data: VisualData }) {
  return <article className="tr-atom" data-role={data.role} data-kind={data.kind} data-title={data.title || undefined}>
    {data.presentation && <div className="tr-origin">{data.origin}</div>}
    {data.payload?.kind === 'PLOT' ? data.payload.plotKind === 'FUNCTION_2D'
      ? <FunctionPlot state={data.step.state} payload={data.payload} /> : <EnergyProfile state={data.step.state} payload={data.payload} />
      : data.payload?.kind === 'EQUATION' ? data.payload.format === 'TRIG'
        ? <TrigEquation state={data.step.state} payload={data.payload} comparing={data.presentation} /> : <Equation state={data.step.state} reference={data.payload.equation} />
        : data.title ? <h1 data-semantic-id={data.reference?.id}>{data.text}</h1> : <p data-semantic-id={data.reference?.id}>{data.text}</p>}
  </article>;
}
function VisualNode({ data }: NodeProps<Node<VisualData>>) {
  const instance = useId();
  return <div data-canonical-id={data.id} data-render-instance={instance} data-suppressed={data.suppressed}
    data-presentation={data.presentation} aria-hidden={data.suppressed || undefined} style={{ opacity: data.suppressed ? 0 : 1 }}>
    <VisualContent data={data} />
  </div>;
}
const nodeTypes = { teaching: VisualNode };
function measure(items: Visual[], step: LessonStep, composing: boolean): HomeGeometry['sizes'] {
  const host = document.createElement('div'); host.className = 'tr-spike tr-measure'; host.setAttribute('aria-hidden', 'true');
  document.body.append(host);
  try {
    return Object.fromEntries(items.map(item => {
      const width = (composing ? item.presentationWidth : undefined) ?? item.width
        ?? (item.kind === 'REPRESENTATION' ? 560 : item.title ? 1080 : item.reference?.id === step.refs.definition?.id ? 1080 : 500);
      const probe = document.createElement('div'); probe.style.width = `${width}px`;
      probe.innerHTML = renderToStaticMarkup(<VisualContent data={{ ...item, step, suppressed: false, presentation: composing && item.role !== 'history' }} />);
      host.append(probe); const height = Math.ceil(probe.getBoundingClientRect().height); probe.remove();
      return [item.id, { width, height }];
    }));
  } finally { host.remove(); }
}
export type CanvasEvidence = { homes: HomeGeometry; positions: MotionBoxes; camera: { x: number; y: number; zoom: number }; moving: boolean; motionSafe: boolean; projection: LearnerProjection };
function CanvasPane({ step, production, projection, onEvidence, catalogFor = canvasCatalog }: { step: LessonStep; production: Production; projection: LearnerProjection; onEvidence: (e: CanvasEvidence) => void; catalogFor?: typeof canvasCatalog }) {
  const container = useRef<HTMLDivElement>(null);
  const homes = useRef<HomeGeometry>(emptyHomes());
  const [surface, setSurface] = useState({ width: 1280, height: 640 });
  const catalog = useMemo(() => catalogFor(step, production, projection), [step, production, projection, catalogFor]);
  const rendered = useRef<MotionBoxes>({});
  const [geometry, setGeometry] = useState<MotionBoxes>({});
  const [frame, setFrame] = useState<TeachingFrame>();
  const [moving, setMoving] = useState(false);
  const [returning, setReturning] = useState<string[]>([]);
  const lastSelected = useRef<string[]>([]);
  const [failure, setFailure] = useState('');
  const { setViewport, getViewport } = useReactFlow();
  useEffect(() => {
    let pending = 0;
    const observer = new ResizeObserver(([e]) => {
      const next = { width: e.contentRect.width, height: e.contentRect.height };
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => setSurface(old => old.width === next.width && old.height === next.height ? old : next));
    });
    observer.observe(container.current!); return () => { observer.disconnect(); cancelAnimationFrame(pending); };
  }, []);
  useEffect(() => {
    let cancelled = false; let animation = 0;
    const run = async () => {
      await document.fonts.ready;
      const composing = ['WIDEN', 'COMPARE'].includes(catalog.scene.framing);
      const homeSizes = measure(catalog.items, step, false);
      const nextHomes = establishHomes(homes.current, catalog.items, homeSizes);
      const sizes = composing ? measure(catalog.items, step, true) : homeSizes;
      const temporary = await presentationPositions(catalog.scene, nextHomes, sizes, surface.width, surface.height);
      if (cancelled) return;
      homes.current = nextHomes;
      const nextFrame: TeachingFrame = { scene: catalog.scene, positions: temporary.positions, sizes, solveMs: temporary.solveMs, notes: [] };
      setFrame(nextFrame);
      const target: MotionBoxes = Object.fromEntries(catalog.items.map(item => [item.id, {
        ...(temporary.positions[item.id] ?? nextHomes.positions[item.id] ?? plotAttachment(nextHomes, item)), ...sizes[item.id],
        presentation: composing && catalog.scene.required.includes(item.id),
      }]));
      const returningIds = composing ? [] : lastSelected.current;
      setReturning(returningIds); lastSelected.current = composing ? catalog.scene.required : [];
      const selected = composing ? catalog.scene.required : returningIds;
      const motion = planMotion(rendered.current, target, selected);
      const camera = cameraFor(catalog.scene, target, sizes, surface.width, surface.height);
      if (!catalog.scene.preserve) void setViewport(camera, { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320 });
      const started = performance.now(); setMoving(true);
      const tick = (now: number) => {
        if (cancelled) return;
        const t = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : Math.min(1, (now - started) / 320);
        const next = sampleMotion(motion, t * t * (3 - 2 * t));
        rendered.current = next; setGeometry(next);
        if (t < 1) animation = requestAnimationFrame(tick);
        else { setMoving(false); setReturning([]); onEvidence({ homes: nextHomes, positions: next, camera: getViewport(), moving: false, motionSafe: motion.safe, projection }); }
      };
      animation = requestAnimationFrame(tick);
    };
    run().catch(e => { if (!cancelled) setFailure(String(e)); });
    return () => { cancelled = true; cancelAnimationFrame(animation); };
  }, [catalog, step, surface, projection, onEvidence, setViewport, getViewport]);
  const nodes = catalog.items.map(item => {
    const box = geometry[item.id];
    const layer = frame ? visualLayer(item, frame, returning) : 'home';
    const composing = frame && ['WIDEN', 'COMPARE'].includes(frame.scene.framing);
    const suppressed = !box || layer === 'suppressed' || (item.kind === 'REPRESENTATION' && ((composing && !frame.scene.required.includes(item.id)) || returning.length > 0)) || (!composing && !returning.length && item.coreId !== step.state.knowledge.currentCoreId);
    return { id: item.id, type: 'teaching', position: { x: box?.x ?? 0, y: box?.y ?? 0 }, style: { width: box?.width ?? 500, height: box?.height ?? 40 }, measured: { width: box?.width ?? 500, height: box?.height ?? 40 },
      data: { ...item, step, suppressed, presentation: box?.presentation ?? false }, draggable: false };
  });
  const visibleIds = new Set(nodes.filter(n => !n.data.suppressed).map(n => n.id));
  const connectors = !moving ? catalog.links.flatMap(link => {
    const from = geometry[visualId(link.from)], to = geometry[visualId(link.to)];
    if (!from || !to || !visibleIds.has(visualId(link.from)) || !visibleIds.has(visualId(link.to))) return [];
    const x = from.x + 16;
    return [{ id: link.ref.id, arrow: link.connector === 'arrow', path: `M${x},${from.y + from.height + 7} L${x},${to.y - 8}` }];
  }) : [];
  const composing = projection.transition.framing === 'WIDEN' || projection.transition.framing === 'COMPARE';
  const comparisonTargets = catalog.scene.required.filter(id => catalog.items.find(i => i.id === id)?.kind !== 'REPRESENTATION');
  if (!moving && composing && comparisonTargets.length === 2) {
    const [a, b] = comparisonTargets.map(id => ({ id, ...geometry[id] }));
    if (a.width && b.width) { const route = routeRelation(a, b, catalog.scene.required.map(id => ({ id, ...geometry[id] }))); if (route) connectors.push({ id: 'visual-proximity-only', arrow: false, path: route.path }); }
  }
  return <div ref={container} className="tr-projector" aria-label="Simulated learner projector" data-step={step.id} data-moving={moving}>
    {failure && <p role="alert">Canvas unavailable: {failure}</p>}
    <ReactFlow nodes={nodes} nodeTypes={nodeTypes} nodesConnectable={false} elementsSelectable={false} zoomOnScroll={false} zoomOnPinch={false}
      zoomOnDoubleClick={false} panOnDrag={false} minZoom={1} maxZoom={1}>
      <ViewportPortal>
        {!composing && !returning.length && step.refs.pathway && step.state.knowledge.currentCoreId === step.refs.catalystCore.id && <div className="tr-neighborhood" style={{ left: -20, top: (homes.current.positions[visualId(step.refs.pathway)]?.y ?? 165) - 18, height: Math.max(70, ...['pathway', 'lower', 'fraction', 'rate'].flatMap(key => { const box = geometry[visualId(step.refs[key] ?? step.refs.pathway)]; return box ? [box.y + box.height - (homes.current.positions[visualId(step.refs.pathway)]?.y ?? 165) + 36] : []; })) }} />}
        <svg className="tr-connectors" width="1" height="1" aria-hidden="true">
          <defs><marker id="tr-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1 L9 5 L1 9" fill="none" stroke="currentColor" /></marker></defs>
          {connectors.map(c => <path key={c.id} data-relation-id={c.id} d={c.path} markerEnd={c.arrow ? 'url(#tr-arrow)' : undefined} />)}
        </svg>
      </ViewportPortal>
    </ReactFlow>
  </div>;
}
export default function Canvas(props: Parameters<typeof CanvasPane>[0]) {
  return <ReactFlowProvider><CanvasPane {...props} /></ReactFlowProvider>;
}
