import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, ViewportPortal, useReactFlow, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { projectCanvas, type CanvasNode } from "../../canvas-spatial/canvas-projection.ts";
import { emptyProjector, followTeaching, inspectRegion, inspectViewport, updateProjector, type ProjectorResult } from "../../canvas-spatial/projector.ts";
import type { Size, Viewport } from "../../canvas-spatial/geometry.ts";
import { SCENARIOS } from "./scenarios.ts";
import { sampleFrame, sampleSize, sampleSpatial } from "./teaching-sample.ts";
import "./teaching-sample.css";

const story = SCENARIOS.find(scenario => scenario.id === "shared-inspection")!.steps;

function SampleNode({ data }: NodeProps<CanvasNode>) {
  const objectId: string = JSON.parse(data.spatialKey)[3];
  let content = <>{data.text}</>;
  // Inline emphasis preserves the complete accepted proposition as real text.
  const phrase = objectId === "alternative-path" ? "alternative reaction pathway."
    : objectId === "lower-ea" ? "lower activation energy." : undefined;
  if (phrase && data.text.endsWith(phrase)) content = <>{data.text.slice(0, -phrase.length)}<mark>{phrase}</mark></>;
  return <article className="teaching-sample-node" data-kind={data.kind} data-object={objectId}
    data-role={data.role} data-spatial-key={data.spatialKey}>
    {data.kind === "CORE" ? <h1>{data.text}</h1> : <p>{content}</p>}
    <Handle type="source" position={Position.Right} style={{ top: objectId === "alternative-path" ? "68%" : "50%" }} />
    <Handle type="target" position={Position.Right} style={{ top: objectId === "lower-ea" ? "31%" : "50%" }} />
  </article>;
}
const nodeTypes = { teaching: SampleNode };

function SampleCanvas() {
  const [index, setIndex] = useState(2);
  // Choose a composition on entry; viewport resize never relocates its objects.
  const [compact] = useState(() => window.innerWidth < 1000);
  const [surface, setSurface] = useState<Size>({ width: 0, height: 0 });
  const [projector, setProjector] = useState(emptyProjector);
  const controller = useRef(projector);
  const [playing, setPlaying] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [reduced, setReduced] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const { setViewport, getViewport } = useReactFlow<CanvasNode>();
  const current = story[index]!;
  const spatial = useMemo(() => sampleSpatial(current, compact), [current, compact]);
  const rendered = useMemo(() => {
    const result = projectCanvas(current.state, current.projection, spatial);
    return { nodes: result.nodes, edges: result.edges.map(edge => ({ ...edge,
      type: "smoothstep", pathOptions: { borderRadius: compact ? 18 : 45, offset: compact ? 15 : 48 },
      markerEnd: { type: MarkerType.Arrow, markerUnits: "userSpaceOnUse", width: compact ? 30 : 60, height: compact ? 30 : 60, strokeWidth: 2, color: "#499573" },
      style: { stroke: "#499573", strokeWidth: compact ? 3 : 6, strokeLinecap: "round" as const },
    })) };
  }, [current, spatial, compact]);
  const execute = useCallback((result: ProjectorResult) => {
    controller.current = result.state;
    setProjector(result.state);
    if (result.command) void setViewport(result.command.target, { duration: result.command.duration, interpolate: "linear" });
  }, [setViewport]);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSurface({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stageRef.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync(); media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (!surface.width || !surface.height) return;
    const frame = sampleFrame(current, spatial, surface, compact);
    execute(updateProjector(controller.current, frame, "REFRAME_ATTENTION", surface, reduced));
  }, [current, spatial, surface, compact, reduced, execute]);
  const go = useCallback((step: number) => {
    setPlaying(false);
    setIndex(Math.max(0, Math.min(story.length - 1, step)));
  }, []);
  useEffect(() => {
    if (!playing) return;
    if (index === story.length - 1) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setIndex(step => step + 1), 5500);
    return () => window.clearTimeout(timer);
  }, [playing, index]);
  const manual = useCallback((viewport: Viewport) => {
    const next = inspectViewport(controller.current, viewport);
    controller.current = next; setProjector(next);
  }, []);
  const follow = useCallback(() => execute(followTeaching(controller.current, surface, reduced)), [execute, surface, reduced]);
  const replay = useCallback(() => {
    go(0);
    const next = { ...emptyProjector(), viewport: getViewport() };
    controller.current = next; setProjector(next);
  }, [go, getViewport]);
  const zoom = (factor: number) => {
    const old = getViewport(), nextZoom = Math.max(.3, Math.min(2, old.zoom * factor));
    const next = { x: surface.width / 2 - (surface.width / 2 - old.x) * nextZoom / old.zoom,
      y: surface.height / 2 - (surface.height / 2 - old.y) * nextZoom / old.zoom, zoom: nextZoom };
    manual(next); void setViewport(next, { duration: 0 });
  };
  const review = () => {
    const frame = sampleFrame(current, spatial, surface, compact, "catalysts");
    execute(inspectRegion(controller.current, frame.all, surface, reduced));
    setControlsOpen(false);
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1); }
      if (event.key.toLowerCase() === "f") follow();
      if (event.key === "Escape") setControlsOpen(false);
    };
    const outside = (event: PointerEvent) => {
      if (!controlsRef.current?.contains(event.target as Node)) setControlsOpen(false);
    };
    window.addEventListener("keydown", keydown); window.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("keydown", keydown); window.removeEventListener("pointerdown", outside); };
  }, [index, go, follow]);
  const inspecting = projector.mode === "TEACHER_INSPECTION";
  const size = sampleSize(compact);
  return <main className="teaching-sample" data-compact={compact} data-step={index} data-mode={projector.mode}
    data-current-core={current.state.knowledge.currentCoreId} data-reduced-motion={reduced}>
    <header className="teaching-sample-header">
      <span className="teaching-sample-brand">CueLayer</span>
      <button className="teaching-sample-follow" data-inspecting={inspecting} onClick={follow}
        aria-label={inspecting ? "Follow teaching" : "Following teaching"}>
        <span className="teaching-sample-dot" aria-hidden="true" />{inspecting ? "Follow teaching" : "Following teaching"}
      </button>
    </header>
    {inspecting && <div className="teaching-sample-inspection" role="status">Reviewing together · teaching continues{current.state.knowledge.currentCoreId === "arrhenius" ? " in Arrhenius" : " in Catalysts"}</div>}
    <div className="teaching-sample-stage" ref={stageRef}>
      <ReactFlow<CanvasNode> nodes={rendered.nodes} edges={rendered.edges} nodeTypes={nodeTypes}
        nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} elementsSelectable={false}
        nodesFocusable={false} edgesFocusable={false} deleteKeyCode={null} selectionKeyCode={null}
        minZoom={.3} maxZoom={2} attributionPosition="bottom-left"
        onMoveStart={event => {
          if (!event) return;
          const viewport = getViewport(); manual(viewport); void setViewport(viewport, { duration: 0 });
        }}
        onMove={(event, viewport) => { if (event) controller.current = inspectViewport(controller.current, viewport); }}
        onMoveEnd={(event, viewport) => { if (event) manual(viewport); }}
        aria-label="Shared teaching canvas; drag to review, F to follow teaching">
        <ViewportPortal>
          {current.state.knowledge.cores.catalysts?.objects["alternative-path"] && <div className="teaching-sample-neighborhood" aria-hidden="true" />}
          {current.state.knowledge.cores.arrhenius?.objects.equation && <div className="teaching-sample-equation-area" style={{ left: size.width + 280 + (compact ? 12 : 111) }} aria-hidden="true" />}
        </ViewportPortal>
      </ReactFlow>
    </div>
    <div className="teaching-sample-controls" ref={controlsRef}>
      {controlsOpen && <section className="teaching-sample-control-panel" id="lesson-controls" aria-label="Lesson controls">
        <div className="teaching-sample-progress"><span>Teaching sample</span><span>{index + 1} / {story.length}</span></div>
        <p>{current.label}</p>
        <div className="teaching-sample-playback">
          <button onClick={replay}>Replay</button>
          <button onClick={() => go(index - 1)} disabled={index === 0}>Previous</button>
          <button onClick={() => go(index + 1)} disabled={index === story.length - 1}>Next</button>
          <button onClick={() => setPlaying(!playing)} disabled={index === story.length - 1}>{playing ? "Pause" : "Play"}</button>
        </div>
        <div className="teaching-sample-camera">
          <button onClick={review}>Review Catalysts</button>
          <button onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">−</button>
          <button onClick={() => zoom(1.2)} aria-label="Zoom in">+</button>
        </div>
        <small>Drag to review · ← → to step · F to follow</small>
      </section>}
      <button className="teaching-sample-controls-toggle" aria-expanded={controlsOpen} aria-controls="lesson-controls"
        onClick={() => setControlsOpen(!controlsOpen)}>{controlsOpen ? "Close controls" : "Lesson controls"}</button>
    </div>
    <span className="teaching-sample-sr" aria-live="polite">{current.label}</span>
  </main>;
}

export default function TeachingSample() {
  return <ReactFlowProvider><SampleCanvas /></ReactFlowProvider>;
}
