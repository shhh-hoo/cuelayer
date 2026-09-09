import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Background, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, type NodeChange, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { advanceSpatial, emptySpatial, measureSpatial, rectOf } from "../../canvas-spatial/spatial.ts";
import { attentionFrame, projectCanvas, type CanvasNode } from "../../canvas-spatial/canvas-projection.ts";
import { emptyProjector, followTeaching, inspectRegion, inspectViewport, updateProjector, type ProjectorResult } from "../../canvas-spatial/projector.ts";
import type { Size, Viewport } from "../../canvas-spatial/geometry.ts";
import { SCENARIOS, type Scenario } from "./scenarios.ts";
import "./m4b-canvas.css";

function TeachingNode({ data }: NodeProps<CanvasNode>) {
  const equation = data.representationId === "ionisation-equation";
  return <article className={`m4b-node m4b-${data.kind.toLowerCase()}`} data-role={data.role}
    data-parked={data.parked} data-inspected={data.inspected} data-spatial-key={data.spatialKey}>
    <Handle type="target" position={Position.Top} />
    <span className="m4b-node-label">{data.label.replaceAll("_", " ")}</span>
    <div className="m4b-node-content nodrag nowheel">
      {equation ? <><div className="m4b-equation" aria-label="X gas yields X plus gas and an electron">X(g) → X⁺(g) + e⁻</div><small>Equivalent notation of the established definition · fixture display</small></> : <p>{data.text}</p>}
      {data.representationId && data.kind === "REPRESENTATION" ? <small>{data.representationId}</small> : null}
    </div>
    <Handle type="source" position={Position.Bottom} />
  </article>;
}
const nodeTypes = { teaching: TeachingNode };
const initial = (scenario: Scenario) => advanceSpatial(emptySpatial(scenario.steps[0]!.state.sessionId), scenario.steps[0]!.state, scenario.steps[0]!.projection);

function Canvas({ scenario, preset, reducedOverride }: { scenario: Scenario; preset: string; reducedOverride: boolean }) {
  const [index, setIndex] = useState(0);
  const [spatial, setSpatial] = useState(() => initial(scenario));
  const [surface, setSurface] = useState<Size>({ width: 0, height: 0 });
  const [reducedSystem, setReducedSystem] = useState(false);
  const [projector, setProjector] = useState(emptyProjector);
  const controller = useRef(projector);
  const [commands, setCommands] = useState(0);
  const [inspectedCoreId, setInspectedCoreId] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const { setViewport, getViewport } = useReactFlow<CanvasNode>();
  const reduced = reducedSystem || reducedOverride;
  const current = scenario.steps[index]!;
  const rendered = useMemo(() => projectCanvas(current.state, current.projection, spatial, inspectedCoreId), [current, spatial, inspectedCoreId]);
  const execute = useCallback((result: ProjectorResult) => {
    controller.current = result.state;
    setProjector(result.state);
    if (result.command) {
      setCommands(count => count + 1);
      // Linear interpolation avoids a smooth-zoom excursion through lesson history
      // when the accepted target is a distant Core with the same requested zoom.
      void setViewport(result.command.target, { duration: result.command.duration, interpolate: "linear" });
    }
  }, [setViewport]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedSystem(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSurface(old => old.width === width && old.height === height ? old : { width, height });
    });
    observer.observe(canvasRef.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    execute(updateProjector(controller.current, attentionFrame(current.state, current.projection, spatial), current.projection.projector, surface, reduced));
  }, [current, spatial, surface, reduced, execute]);
  const go = useCallback((nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= scenario.steps.length) return;
    const next = scenario.steps[nextIndex]!;
    setSpatial(old => nextIndex > index ? advanceSpatial(old, next.state, next.projection)
      : scenario.steps.slice(0, nextIndex + 1).reduce((s, item) => advanceSpatial(s, item.state, item.projection), emptySpatial(next.state.sessionId)));
    setIndex(nextIndex);
  }, [index, scenario]);
  useEffect(() => {
    if (!playing || index >= scenario.steps.length - 1) return;
    const timer = window.setTimeout(() => go(index + 1), 2600);
    return () => window.clearTimeout(timer);
  }, [playing, index, scenario.steps.length, go]);
  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    setSpatial(old => changes.reduce((next, change) => change.type === "dimensions" && change.dimensions
      ? measureSpatial(next, decodeURIComponent(change.id.slice(4)), change.dimensions) : next, old));
  }, []);
  const manual = useCallback((viewport: Viewport) => {
    const next = inspectViewport(controller.current, viewport);
    controller.current = next; setProjector(next);
  }, []);
  const jump = (coreId: string) => {
    setInspectedCoreId(coreId);
    const rects = Object.values(spatial.elements).filter(e => e.coreId === coreId && e.kind === "OBJECT").map(rectOf);
    execute(inspectRegion(controller.current, rects, surface, reduced));
  };
  const zoom = (factor: number) => {
    const old = getViewport(), nextZoom = Math.min(2, Math.max(0.3, old.zoom * factor));
    const next = { x: surface.width / 2 - (surface.width / 2 - old.x) * nextZoom / old.zoom,
      y: surface.height / 2 - (surface.height / 2 - old.y) * nextZoom / old.zoom, zoom: nextZoom };
    manual(next); void setViewport(next, { duration: 0 });
  };
  const reset = () => {
    setPlaying(false); setIndex(0); setSpatial(initial(scenario));
    const next = emptyProjector(); controller.current = next; setProjector(next);
    setInspectedCoreId(undefined); setCommands(0);
    void setViewport(next.viewport, { duration: 0 });
  };
  return <section className="m4b-review" data-preset={preset} data-current-core={current.state.knowledge.currentCoreId}
    data-step={index} data-mode={projector.mode} data-camera-commands={commands} data-reduced-motion={reduced}
    data-viewport={JSON.stringify(projector.viewport)}>
    <div className="m4b-playback">
      <div className="m4b-buttons">
        <button onClick={reset}>Reset</button>
        <button onClick={() => { setPlaying(false); go(index - 1); }} disabled={index === 0}>Previous</button>
        <button onClick={() => { setPlaying(false); go(index + 1); }} disabled={index === scenario.steps.length - 1}>Next</button>
        <button onClick={() => setPlaying(!playing)} disabled={index === scenario.steps.length - 1}>{playing ? "Pause" : "Play"}</button>
      </div>
      <p><strong>{index + 1}/{scenario.steps.length}</strong> · {current.label}</p>
    </div>
    <div className="m4b-status" aria-live="polite">
      <span>currentCoreId <b>{current.state.knowledge.currentCoreId}</b></span>
      <span>{current.projection.transition.framing}</span><span>{current.projection.projector}</span>
      <span data-testid="viewport-mode">{projector.mode}</span>
    </div>
    <div className="m4b-canvas" ref={canvasRef}>
      <ReactFlow<CanvasNode> nodes={rendered.nodes} edges={rendered.edges} nodeTypes={nodeTypes}
        defaultViewport={emptyProjector().viewport} onNodesChange={onNodesChange}
        nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} elementsSelectable={false}
        deleteKeyCode={null} selectionKeyCode={null} minZoom={0.3} maxZoom={2}
        onMoveStart={event => {
          if (!event) return;
          const viewport = getViewport();
          manual(viewport);
          // Interrupt any in-flight programmatic animation before a teacher gesture.
          void setViewport(viewport, { duration: 0 });
        }}
        onMove={(event, viewport) => { if (event) controller.current = inspectViewport(controller.current, viewport); }}
        onMoveEnd={(event, viewport) => { if (event) manual(viewport); }}
        aria-label="Shared classroom teaching Canvas">
        <Background color="#cbd4cf" gap={28} size={1} />
      </ReactFlow>
      <div className="m4b-camera-tools">
        <button className="m4b-live" onClick={() => { setInspectedCoreId(undefined); execute(followTeaching(controller.current, surface, reduced)); }}>Follow teaching →</button>
        <button aria-label="Zoom in for inspection" onClick={() => zoom(1.2)}>+</button>
        <button aria-label="Zoom out for inspection" onClick={() => zoom(1 / 1.2)}>−</button>
      </div>
      <div className="m4b-core-jumps" aria-label="Inspect established Cores">{Object.keys(current.state.knowledge.cores).map(id =>
        <button key={id} onClick={() => jump(id)}>Inspect {id}</button>)}</div>
    </div>
    <footer className="m4b-footer">
      <p>{current.note ?? "Drag to pan or scroll to zoom. Inspection holds the shared camera until Follow teaching."}</p>
      <span>{rendered.nodes.length} elements · {commands} camera commands · {Math.round(surface.width)}×{Math.round(surface.height)} Canvas · {reduced ? "reduced motion" : "220 ms transitions"}</span>
    </footer>
  </section>;
}

export default function M4BCanvas() {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0]!.id);
  const [preset, setPreset] = useState("desktop");
  const [reduced, setReduced] = useState(false);
  const scenario = SCENARIOS.find(item => item.id === scenarioId)!;
  return <main className="m4b-harness" data-width={preset}>
    <header className="m4b-header">
      <div><span className="m4b-eyebrow">CueLayer · development review</span><h1>Canvas spatial runtime</h1></div>
      <div className="m4b-options">
        <label>Scenario<select value={scenarioId} onChange={event => setScenarioId(event.target.value)}>{SCENARIOS.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label>Viewport<select value={preset} onChange={event => setPreset(event.target.value)}><option value="desktop">1280 × 720</option><option value="narrow">390 × 844</option></select></label>
        <label className="m4b-motion"><input type="checkbox" checked={reduced} onChange={event => setReduced(event.target.checked)} /> Reduced motion</label>
      </div>
    </header>
    <ReactFlowProvider key={scenarioId}><Canvas scenario={scenario} preset={preset} reducedOverride={reduced} /></ReactFlowProvider>
  </main>;
}
