import { Profiler, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ProfilerOnRenderCallback } from "react";
import { Background, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow, type NodeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CoreOriginNode, KnowledgeNode, SupportNode } from "./CanvasNodes";
import { STEPS } from "./fixture";
import { lessonCounts, type Lesson } from "./model";
import { attentionBounds, projectCanvas, type CanvasNode } from "./projection";
import { boundsOf, emptySpatial, followCamera, moveSpatial, nodeSize, placeAdditions, type Bounds, type Camera, type Size } from "./spatial";
import { useFixture } from "./useFixture";
import "./core-canvas.css";

const nodeTypes = { knowledge: KnowledgeNode, coreOrigin: CoreOriginNode, support: SupportNode };
const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
const coreName = (id: string) => id === "catalyst" ? "Catalysts" : "Arrhenius equation";

function Canvas() {
  const { playback, dispatch } = useFixture();
  const { lesson, index, resetKey, playing } = playback;
  const [spatial, setSpatial] = useState(emptySpatial);
  const [camera, setCamera] = useState(INITIAL_CAMERA);
  const [surface, setSurface] = useState<Size>({ width: 0, height: 0 });
  const [inspectedCoreId, setInspectedCoreId] = useState<string | null>(null);
  const [gesture, setGesture] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [layoutMs, setLayoutMs] = useState(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const renderOutput = useRef<HTMLOutputElement>(null);
  const renderTiming = useRef({ last: 0, max: 0 });
  const handledOperation = useRef("");
  const placedLesson = useRef<Lesson | null>(null);
  const { setViewport, fitView } = useReactFlow<CanvasNode>();
  const nodesInitialized = useNodesInitialized();
  const projection = useMemo(() => projectCanvas(lesson, spatial, inspectedCoreId), [lesson, spatial, inspectedCoreId]);
  const counts = lessonCounts(lesson);
  const step = STEPS[index]!;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSurface({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(canvasRef.current!);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (placedLesson.current === lesson) return;
    const started = performance.now();
    const next = placeAdditions(lesson, spatial, surface.width / camera.zoom);
    setLayoutMs(performance.now() - started);
    placedLesson.current = lesson;
    setSpatial(next);
  }, [camera.zoom, lesson, spatial, surface.width]);

  const currentDetail = useCallback((coreId: string): Bounds => {
    const core = lesson.cores.find(item => item.id === coreId)!;
    const node = core.nodes.at(-1)!;
    const origin = spatial.coreOrigins[coreId]!;
    return { x: origin.x + spatial.positions[node.id]!.x, y: origin.y + spatial.positions[node.id]!.y, ...(spatial.sizes[node.id] ?? nodeSize(node)) };
  }, [lesson, spatial]);
  const focusCore = useCallback((coreId: string, force = true) => {
    if (!spatial.coreOrigins[coreId]) return;
    const bounds = attentionBounds(lesson, spatial, coreId);
    // Even a narrow view keeps some Core context beside a new extra.
    const detail = coreId === lesson.currentCoreId && step.operation.kind === "support"
      ? boundsOf([bounds.at(-1)!, currentDetail(coreId)]) : currentDetail(coreId);
    const next = followCamera(camera, surface, boundsOf(bounds), detail, force);
    void setViewport(next, { duration: reducedMotion ? 0 : 220 });
    setInspectedCoreId(coreId === lesson.currentCoreId ? null : coreId);
  }, [camera, currentDetail, lesson, reducedMotion, setViewport, spatial, step.operation.kind, surface]);

  useEffect(() => {
    const key = `${resetKey}:${index}`;
    const placed = lesson.cores.every(core => core.nodes.every(node => spatial.positions[node.id]));
    if (handledOperation.current === key || gesture || !nodesInitialized || !placed || !surface.width || !surface.height) return;
    handledOperation.current = key;
    focusCore(lesson.currentCoreId, inspectedCoreId !== null || index === 0 || step.operation.kind === "begin");
  }, [focusCore, gesture, index, inspectedCoreId, lesson, nodesInitialized, resetKey, spatial, step.operation.kind, surface]);

  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    setSpatial(previous => {
      let next = previous;
      for (const change of changes) {
        if (change.type === "position" && change.position) next = moveSpatial(next, change.id, change.position);
        if (change.type === "dimensions" && change.dimensions && !change.id.startsWith("core:")) {
          const old = next.sizes[change.id];
          if (old?.width !== change.dimensions.width || old.height !== change.dimensions.height) {
            next = { ...next, sizes: { ...next.sizes, [change.id]: change.dimensions } };
          }
        }
      }
      return next;
    });
  }, []);
  const onRender = useCallback<ProfilerOnRenderCallback>((_id, _phase, actualDuration) => {
    renderTiming.current = { last: actualDuration, max: Math.max(renderTiming.current.max, actualDuration) };
    if (renderOutput.current) renderOutput.current.value = `${actualDuration.toFixed(2)} ms · max ${renderTiming.current.max.toFixed(2)}`;
  }, []);
  const reset = () => {
    setSpatial(emptySpatial()); setInspectedCoreId(null); setGesture(false);
    handledOperation.current = ""; renderTiming.current = { last: 0, max: 0 };
    dispatch({ type: "reset" });
  };

  return <main className="core-canvas-spike" data-current-core={lesson.currentCoreId} data-step={index} data-playing={playing} data-reduced-motion={reducedMotion}>
    <header className="spike-header">
      <div><span className="spike-eyebrow">Teaching canvas</span><strong>Current · {coreName(lesson.currentCoreId)}</strong></div>
      <details className="spike-tools">
        <summary>Inspect</summary>
        <div className="spike-tool-panel">
          <p>Scripted renderer experiment · no live session</p>
          <div className="spike-buttons">
            <button onClick={() => dispatch({ type: "toggle" })} disabled={index === STEPS.length - 1}>{playing ? "Pause" : "Play"}</button>
            <button onClick={reset}>Reset</button>
            <button onClick={() => dispatch({ type: "next" })} disabled={index === STEPS.length - 1}>Next operation</button>
            <button onClick={() => focusCore(lesson.currentCoreId)}>Focus current Core</button>
            <button onClick={() => { setInspectedCoreId(null); void fitView({ nodes: projection.nodes.filter(node => node.type !== "coreOrigin"), padding: 0.18, minZoom: 0.1, maxZoom: 1, duration: reducedMotion ? 0 : 220 }); }}>Fit all</button>
            <button onClick={() => focusCore("catalyst")}>Jump to Catalyst</button>
            <button onClick={() => focusCore("arrhenius")} disabled={!spatial.coreOrigins.arrhenius}>Jump to Arrhenius</button>
          </div>
          <p>Drag empty canvas to pan. Scroll or pinch to zoom. Drag a node, or its “Move Core” grip. The next teaching update returns to current content.</p>
        </div>
      </details>
    </header>
    <div className="spike-canvas" ref={canvasRef}>
      <Profiler id="core-canvas" onRender={onRender}>
        <ReactFlow<CanvasNode>
          nodes={projection.nodes} edges={projection.edges} nodeTypes={nodeTypes}
          defaultViewport={INITIAL_CAMERA} onViewportChange={setCamera} onNodesChange={onNodesChange}
          minZoom={0.1} maxZoom={2} nodesConnectable={false} edgesReconnectable={false}
          deleteKeyCode={null} selectionKeyCode={null} elevateNodesOnSelect={false}
          onNodeDragStart={() => setGesture(true)} onNodeDragStop={() => setGesture(false)}
          onMoveStart={event => { if (event) setGesture(true); }} onMoveEnd={event => { if (event) setGesture(false); }}
          onNodeClick={(_event, node) => setInspectedCoreId(node.data.coreId === lesson.currentCoreId ? null : node.data.coreId)}
          onPaneClick={() => setInspectedCoreId(null)}
          aria-label="Teaching canvas"
        >
          <Background color="#d5dbce" gap={32} size={1} />
        </ReactFlow>
      </Profiler>
      {inspectedCoreId ? <div className="spike-inspection">Inspecting parked {coreName(inspectedCoreId)} · teaching remains on {coreName(lesson.currentCoreId)}</div> : null}
    </div>
    <footer className="spike-diagnostics">
      <span className="spike-operation">{index + 1}/{STEPS.length} · {step.label} · {playing ? "playing" : index === STEPS.length - 1 ? "complete" : "paused"}</span>
      <span>{counts.nodes} nodes · {counts.relations} relations · {counts.supports} Supports · {counts.parked} parked</span>
      <span>Layout <output data-layout-ms={layoutMs}>{layoutMs.toFixed(2)} ms</output> · React render <output ref={renderOutput}>{renderTiming.current.last.toFixed(2)} ms · max {renderTiming.current.max.toFixed(2)}</output></span>
    </footer>
  </main>;
}

export default function CoreCanvasSpike() {
  return <ReactFlowProvider><Canvas /></ReactFlowProvider>;
}
