import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { BaseEdge, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, ViewportPortal, useReactFlow, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { bounds, type Point, type Size, type Viewport } from "../../canvas-spatial/geometry.ts";
import { CHOREOGRAPHY_SCENARIOS, type ChoreographyStep } from "./scenarios.ts";
import { acceptFrame, emptyChoreography, emptyHomes, inspectCoreFrame, inspectFrame, resumeFrame, teachingScene, type ChoreographyState, type HomeGeometry, type TeachingFrame, type TeachingItem } from "./model.ts";
import { GAP, measureItems, minimumFont, prepareTeachingFrame, readableRegion, teachingFont } from "./measurement.ts";
import { compositionMetrics } from "./metrics.ts";
import type { SolverId } from "./solvers.ts";
import HomeMap from "./HomeMap.tsx";
import { isComposition, visualLayer, type VisualLayer } from "./presentation.ts";
import { routeRelation, type RelationBox } from "./relations.ts";
import { planMotion, sampleMotion, type MotionBox } from "./motion.ts";
import "./choreography.css";

type NodeData = TeachingItem & { font: number; presentation: boolean; home?: Point; layer: VisualLayer; framing: TeachingFrame["scene"]["framing"] };
type TeachingNode = Node<NodeData, "knowledge">;
const MOTION_MS = 320;
const SOLVERS: { id: SolverId; name: string }[] = [{ id: "baseline", name: "Measured baseline" }, { id: "webcola", name: "WebCola" }, { id: "elk", name: "ELK" }];
function KnowledgeNode({ data }: NodeProps<TeachingNode>) {
  const instance = useId();
  return <article className="choreo-node" data-kind={data.kind} data-role={data.role} data-layer={data.layer} data-framing={data.framing}
    aria-hidden={data.layer === "suppressed" || undefined}
    data-canonical-id={data.id} data-render-instance={instance} data-presentation={data.presentation}
    style={{ "--teaching-font": `${data.font}px` } as CSSProperties}>
    {data.presentation && data.coreId && data.kind !== "CORE" && <div className="choreo-origin">{data.coreId.replaceAll("-", " ")}</div>}
    {data.kind === "CORE" ? <h2 className="choreo-copy">{data.text}</h2> : <p className="choreo-copy">{data.text}</p>}
    <Handle type="source" id="right" position={Position.Right} /><Handle type="target" id="right" position={Position.Right} />
    <Handle type="source" id="left" position={Position.Left} /><Handle type="target" id="left" position={Position.Left} />
  </article>;
}
function RelationEdge(props: EdgeProps) {
  return <BaseEdge path={props.data?.path as string ?? ""} markerEnd={props.markerEnd} style={props.style} />;
}
const nodeTypes = { knowledge: KnowledgeNode };
const edgeTypes = { relation: RelationEdge };
const different = (a: Point, b: Point) => Math.abs(a.x - b.x) > .01 || Math.abs(a.y - b.y) > .01;

function useReducedMotion(override: boolean) {
  const [system, setSystem] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setSystem(media.matches); sync(); media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return override || system;
}

function CanvasPane({ step, solver, homesVisible, diagnostics, reduced, workMode, homeRequest, followRequest }: {
  step: ChoreographyStep; solver: SolverId; homesVisible: boolean; diagnostics: boolean; reduced: boolean;
  workMode: "adjacent" | "attached"; homeRequest: number; followRequest: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [surface, setSurface] = useState<Size>({ width: 0, height: 0 });
  const homes = useRef<HomeGeometry>(emptyHomes());
  const originalHomes = useRef<Record<string, Point>>({});
  const controller = useRef<ChoreographyState>(emptyChoreography());
  const [state, setState] = useState(controller.current);
  const [renderPositions, setRenderPositions] = useState<Record<string, Point>>({});
  const positions = useRef(renderPositions);
  const renderedGeometry = useRef<Record<string, MotionBox>>({});
  const [travelGeometry, setTravelGeometry] = useState<Record<string, MotionBox>>({});
  const [motionNote, setMotionNote] = useState("");
  const animation = useRef(0);
  const lastComposition = useRef<string[]>([]);
  const returning = useRef<string[]>([]);
  const [returningIds, setReturningIds] = useState<string[]>([]);
  const [moving, setMoving] = useState(false);
  const generation = useRef(0);
  const pendingSolve = useRef(false);
  const pendingFollow = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [camera, setCamera] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const { setViewport, getViewport } = useReactFlow<TeachingNode>();
  const compact = surface.width < 600;
  const effectiveReduced = useReducedMotion(reduced);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSurface(previous => previous.width === entry.contentRect.width && previous.height === entry.contentRect.height ? previous
        : { width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(container.current!); return () => observer.disconnect();
  }, []);
  const save = useCallback((next: ChoreographyState) => { controller.current = next; setState(next); }, []);
  const stop = useCallback(() => { cancelAnimationFrame(animation.current); animation.current = 0; }, []);
  useEffect(() => () => stop(), [stop]);
  const move = useCallback((frame: TeachingFrame) => {
    stop();
    const selected = isComposition(frame) ? frame.scene.required : [];
    // Travel retains only visual IDs. Attention/primary roles always come from
    // the newest visible frame, including accepted semantic refocus.
    returning.current = selected.length ? [] : lastComposition.current.length ? lastComposition.current : returning.current;
    lastComposition.current = selected;
    setReturningIds(returning.current); setMoving(true);
    const target = Object.fromEntries(frame.scene.items.map(item => [item.id, {
      ...(frame.positions[item.id] ?? homes.current.positions[item.id] ?? { x: 0, y: 0 }),
      ...frame.sizes[item.id]!, presentation: Boolean((isComposition(frame) || workMode === "attached") && frame.scene.required.includes(item.id)),
    }]));
    const start = Object.fromEntries(frame.scene.items.map(item => {
      const old = renderedGeometry.current[item.id] ?? target[item.id]!;
      // Keep the current accepted role/text, but measure it at its travelling
      // width. Only visual geometry and provenance wait for the phase boundary.
      const size = measureItems([item], old.width, frame.compact ?? compact, old.presentation)[item.id]!;
      return [item.id, { ...old, ...size }];
    }));
    const motion = planMotion(start, target, frame.scene.items.filter(item => item.durable
      && (selected.includes(item.id) || returning.current.includes(item.id))).map(item => item.id));
    setMotionNote(motion.note);
    const started = performance.now();
    const tick = (time: number) => {
      const progress = effectiveReduced ? 1 : Math.min(1, (time - started) / MOTION_MS);
      const easing = progress * progress * (3 - 2 * progress);
      const geometry = sampleMotion(motion, easing);
      const next = Object.fromEntries(Object.entries(geometry).map(([id, box]) => [id, { x: box.x, y: box.y }]));
      setTravelGeometry(geometry); renderedGeometry.current = geometry;
      positions.current = next; setRenderPositions(next);
      animation.current = progress < 1 ? requestAnimationFrame(tick) : 0;
      if (progress === 1) { returning.current = []; setReturningIds([]); setMoving(false); }
    };
    tick(started);
  }, [effectiveReduced, stop, workMode, compact]);
  const frameCamera = useCallback((frame: TeachingFrame, ids = frame.scene.required) => {
    const area = bounds(frame.scene.items.filter(item => ids.includes(item.id) && frame.sizes[item.id])
      .map(item => ({ ...(frame.positions[item.id] ?? homes.current.positions[item.id] ?? { x: 0, y: 0 }), ...frame.sizes[item.id]! })));
    if (!area) return;
    const region = readableRegion(surface);
    // Never conceal a capacity failure by shrinking teaching. Oversized frames
    // remain at full type size, aligned to the start and explicitly marked FAIL.
    const target = { x: 20 + Math.max(0, (region.width - area.width) / 2) - area.x,
      y: 44 + Math.max(0, (region.height - area.height) / 2) - area.y, zoom: 1 };
    setCamera(target); void setViewport(target, { duration: effectiveReduced ? 0 : MOTION_MS, interpolate: "linear" });
  }, [surface, setViewport, effectiveReduced]);
  useEffect(() => {
    if (!surface.width || !surface.height) return;
    const request = ++generation.current;
    pendingSolve.current = true;
    setBusy(true); setError("");
    const scene = teachingScene(step);
    void prepareTeachingFrame(scene, homes.current, surface, solver, workMode, accepted => {
      homes.current = accepted;
      for (const [id, point] of Object.entries(accepted.positions)) originalHomes.current[id] ??= { ...point };
    }).then(result => {
      if (request !== generation.current) return;
      const oldVisible = controller.current.visible;
      let next = acceptFrame(controller.current, result.frame);
      if (pendingFollow.current) { next = resumeFrame(next); pendingFollow.current = false; }
      pendingSolve.current = false;
      save(next); setBusy(false);
      if (next.visible && (next.visible === result.frame || !oldVisible)) {
        move(next.visible); frameCamera(next.visible);
      }
    }).catch(reason => { if (request === generation.current) { pendingSolve.current = false; pendingFollow.current = false; setError(String(reason)); setBusy(false); } });
    return () => { generation.current++; };
  }, [step, surface, solver, workMode, move, frameCamera, save]);
  const manual = useCallback((viewport: Viewport) => {
    stop();
    pendingFollow.current = false;
    const next = inspectFrame(controller.current);
    // Freeze the *currently interpolated* world positions, not the animation's
    // destination. Camera and object choreography both yield to teacher input.
    if (next.visible) next.visible = { ...next.visible, positions: { ...positions.current } };
    save(next); setCamera(viewport);
    void setViewport(viewport, { duration: 0 });
  }, [save, stop, setViewport]);
  const follow = useCallback(() => {
    // An accepted step can still be solving. Keep the teacher's current view
    // until its newest composition is ready; never replay the prior target.
    if (pendingSolve.current) { pendingFollow.current = true; return; }
    const next = resumeFrame(controller.current); save(next);
    if (next.visible) { move(next.visible); frameCamera(next.visible); }
  }, [save, move, frameCamera]);
  const oldFollow = useRef(followRequest);
  useEffect(() => { if (oldFollow.current !== followRequest) { oldFollow.current = followRequest; follow(); } }, [followRequest, follow]);
  const oldHome = useRef(homeRequest);
  useEffect(() => {
    if (oldHome.current === homeRequest || !controller.current.latest) return;
    oldHome.current = homeRequest;
    pendingFollow.current = false;
    const frame = controller.current.latest;
    const scene = { ...frame.scene, framing: "HOME" as const, preserve: false, items: frame.scene.items.map(item => ({ ...item, visible: item.visible && item.durable })),
      required: frame.scene.items.filter(item => item.visible && item.durable && item.coreId === frame.scene.currentCoreId).map(item => item.id) };
    const next = { ...frame, scene, positions: {}, sizes: { ...frame.sizes, ...homes.current.sizes } };
    save({ ...controller.current, mode: "TEACHER_INSPECTION", visible: next });
    move(next); frameCamera(next);
  }, [homeRequest, move, frameCamera, save]);
  const visible = state.visible;
  const visibleCompact = visible?.compact ?? compact;
  const drawnSizes = useMemo(() => Object.fromEntries(Object.entries(visible?.sizes ?? {}).map(([id, size]) =>
    [id, moving && travelGeometry[id] ? { width: travelGeometry[id]!.width, height: travelGeometry[id]!.height } : size])), [visible, moving, travelGeometry]);
  const metrics = useMemo(() => visible ? compositionMetrics(visible.scene.items.filter(item => item.visible).map(item => ({ id: item.id,
    home: homes.current.positions[item.id], position: renderPositions[item.id] ?? visible.positions[item.id] ?? homes.current.positions[item.id] ?? { x: 0, y: 0 },
    ...(drawnSizes[item.id] ?? { width: 1, height: 1 }), fontSize: teachingFont(item, visibleCompact), minimumFontSize: minimumFont(item, compact),
    required: visible.scene.required.includes(item.id) })), visible.scene.edges, readableRegion(surface), GAP, camera.zoom,
    originalHomes.current, homes.current.positions) : undefined, [visible, drawnSizes, renderPositions, camera.zoom, surface, compact, visibleCompact]);
  const composition = Boolean(visible && isComposition(visible));
  const presentationActive = composition || returningIds.length > 0;
  const nodes: TeachingNode[] = (visible?.scene.items ?? []).filter(item => item.visible).map(item => ({ id: item.id, type: "knowledge",
    position: renderPositions[item.id] ?? visible!.positions[item.id] ?? homes.current.positions[item.id] ?? { x: 0, y: 0 },
    style: { width: drawnSizes[item.id]!.width }, data: { ...item, font: teachingFont(item, visibleCompact),
      presentation: moving && travelGeometry[item.id] ? travelGeometry[item.id]!.presentation
        : Boolean((composition || workMode === "attached") && visible!.scene.required.includes(item.id)),
      home: homes.current.positions[item.id], layer: visualLayer(item, visible!, returningIds), framing: visible!.scene.framing } }));
  renderedGeometry.current = Object.fromEntries(nodes.map(node => [node.id, { ...node.position, ...drawnSizes[node.id]!, presentation: node.data.presentation }]));
  const boxes: RelationBox[] = nodes.map(node => ({ id: node.id, x: node.position.x, y: node.position.y, ...drawnSizes[node.id]! }));
  const selectedBoxes = boxes.filter(box => visible!.scene.required.includes(box.id));
  const edges = (visible?.scene.edges ?? []).filter(edge => nodes.some(node => node.id === edge.source) && nodes.some(node => node.id === edge.target)
    && (!composition || visible!.scene.required.includes(edge.source) && visible!.scene.required.includes(edge.target)))
    .flatMap(edge => {
      const route = routeRelation(boxes.find(box => box.id === edge.source)!, boxes.find(box => box.id === edge.target)!, composition ? selectedBoxes : boxes);
      if (!route) return [];
      // During travel there is no old-world line crossing moving text. Once
      // settled, neutral choreography links use the actual presented boxes.
      return [{ ...edge, type: "relation", sourceHandle: route.sourceHandle, targetHandle: route.targetHandle,
        data: { path: route.path }, ariaLabel: edge.label,
        style: { stroke: composition ? "#8aa596" : "#499573", strokeWidth: composition ? 1.5 : 2.5, opacity: moving || returningIds.length ? 0 : 1 },
        markerEnd: composition ? undefined : { type: MarkerType.Arrow, color: "#499573", width: 18, height: 18 } }];
    });
  // Proximity is a presentation cue, never a TeachingEdge or solver input.
  // Only the two-reference cross-Core case gets this neutral, unarrowed link.
  const proximity = visible?.scene.framing === "WIDEN" && selectedBoxes.length === 2
    && new Set(nodes.filter(node => visible.scene.required.includes(node.id)).map(node => node.data.coreId)).size === 2
    && !edges.length ? routeRelation(selectedBoxes[0]!, selectedBoxes[1]!, selectedBoxes) : undefined;
  const diagnostic = metrics && { ...metrics, layoutExecutionMs: visible?.solveMs, mode: state.mode, framing: visible?.scene.framing,
    acceptedLatest: state.latest?.scene.label, visibleStep: visible?.scene.label, surface,
    required: visible?.scene.required, camera, compact: visibleCompact, presentationPositions: visible?.positions,
    moving, returningIds, visualPhase: moving ? state.mode === "TEACHER_INSPECTION" ? "paused" : returningIds.length ? "returning" : "moving" : composition ? "composed" : "home",
    homes: homes.current.positions, positions: renderPositions, measurements: drawnSizes, notes: visible?.notes, motionNote };
  return <section className="choreo-pane" data-solver={solver} data-mode={state.mode} data-ready={!busy} data-error={Boolean(error)} data-moving={moving}>
    <div className="choreo-pane-title"><strong>{SOLVERS.find(item => item.id === solver)!.name}</strong><span>{state.mode === "TEACHER_INSPECTION" ? "Reviewing together" : "Following teaching"}</span></div>
    <div className="choreo-surface" ref={container}>
      <ReactFlow<TeachingNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        nodesDraggable={false} nodesConnectable={false} nodesFocusable={false} edgesFocusable={false} elementsSelectable={false}
        deleteKeyCode={null} selectionKeyCode={null} minZoom={.3} maxZoom={2} attributionPosition="bottom-left"
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        onMoveStart={event => { if (event) manual(getViewport()); }}
        onMove={(_event, viewport) => setCamera(viewport)}
        onMoveEnd={(_event, viewport) => setCamera(viewport)}
        aria-label={`${solver} shared teaching choreography`}>
        <ViewportPortal>
          {proximity && <svg className="choreo-proximity" width="1" height="1" aria-hidden="true" style={{ opacity: moving ? 0 : 1 }}>
            <path data-presentation-proximity d={proximity.path} fill="none" stroke="#8aa596" strokeWidth="1.5" />
          </svg>}
          {visible && Object.entries(homes.current.coreOrigins).map(([core, origin]) => {
            const members = nodes.filter(node => node.data.coreId === core && node.data.kind !== "CORE" && node.data.durable);
            const area = bounds(members.map(node => ({ ...homes.current.positions[node.id]!, ...homes.current.sizes[node.id]! })));
            return area && <div key={core} className="choreo-neighborhood" data-suppressed={presentationActive && visible.inspectedCoreId !== core}
              style={{ left: origin.x - 14, top: area.y - 14, width: area.width + 28, height: area.height + 28 }} />;
          })}
          {homesVisible && nodes.filter(node => node.data.home && different(node.position, node.data.home)).map(node => {
            const home = node.data.home!, dx = node.position.x - home.x, dy = node.position.y - home.y;
            return <div key={node.id} className="choreo-home-marker" style={{ left: home.x, top: home.y }}>
              <span>Home · {node.data.coreId}</span><i style={{ width: Math.hypot(dx, dy), transform: `rotate(${Math.atan2(dy, dx)}rad)` }} />
            </div>;
          })}
        </ViewportPortal>
      </ReactFlow>
      {busy && <div className="choreo-solving" role="status">Measuring and composing…</div>}
      {homesVisible && <HomeMap nodes={nodes.filter(node => node.data.home).map(node => ({ id: node.id,
        home: node.data.home!, position: node.position, label: `${node.data.coreId} · ${node.data.label}` }))} />}
      {error && <div className="choreo-failure" role="alert">SOLVER FAILURE · {error}</div>}
      {metrics && !moving && !metrics.readable && <div className="choreo-capacity" role="status">READABLE FIT FAIL · {metrics.requiredCount} required targets · fit would need {metrics.requiredZoom.toFixed(2)}×<br /><small>Text stays full size. Inspect to see overflow.</small></div>}
      {diagnostics && metrics && <div className="choreo-diagnostics">
        <span>Home changed: <b>{metrics.homeCoordinatesChanged ? "YES" : "no"}</b></span>
        <span>Moved temporarily: <b>{metrics.temporarilyMoved}</b></span>
        <span>Selected overlap: <b>{metrics.selectedOverlapCount}</b> · gap: {metrics.gapViolations}</span>
        <span>Effective type: <b>{metrics.effectiveMinimumFontSize.toFixed(1)}px</b> · zoom needed: {metrics.requiredZoom.toFixed(2)}</span>
        <span>Bounds: {Math.round(metrics.bounds?.width ?? 0)} × {Math.round(metrics.bounds?.height ?? 0)}</span>
        <span>Max displacement: {Math.round(metrics.maximumTemporaryDisplacement)}px</span>
        <span>Layout: {visible!.solveMs.toFixed(2)}ms · crossings≈{metrics.edgeCrossings}</span>
      </div>}
    </div>
    <script type="application/json" data-choreography-diagnostics>{JSON.stringify(diagnostic ?? {})}</script>
    <div className="choreo-review-controls">
      <button onClick={follow}>Follow teaching</button>
      {Object.keys(homes.current.coreOrigins).map(core => <button key={core} onClick={() => {
        manual(getViewport());
        const reviewed = inspectCoreFrame(controller.current, core);
        const next = reviewed.visible;
        if (!next) return;
        const reviewItems = next.scene.items.filter(item => item.coreId === core && item.visible);
        // Inspection retains its measured typography, including across a
        // viewport change. Remeasure new/revised review text at that same size.
        const reviewedTravel = { ...travelGeometry };
        let travelChanged = false;
        for (const item of reviewItems) {
          const held = moving ? travelGeometry[item.id] : undefined;
          const size = measureItems([item], held?.width ?? next.sizes[item.id]!.width, next.compact ?? compact,
            held?.presentation ?? (["COMPARE", "WIDEN"].includes(next.scene.framing) && next.scene.required.includes(item.id)))[item.id]!;
          next.sizes[item.id] = size;
          if (held) {
            // New review text may grow while the interrupted width/provenance
            // stays held. Geometry consumers must use its newly measured height.
            reviewedTravel[item.id] = { ...held, ...size };
            renderedGeometry.current[item.id] = reviewedTravel[item.id]!;
            travelChanged = true;
          }
        }
        if (travelChanged) setTravelGeometry(reviewedTravel);
        save(reviewed);
        frameCamera(next, reviewItems.map(item => item.id));
      }}>Inspect {core.replaceAll("-", " ")}</button>)}
    </div>
  </section>;
}

export default function Choreography() {
  const [scenarioId, setScenarioId] = useState(CHOREOGRAPHY_SCENARIOS[0]!.id);
  const scenario = CHOREOGRAPHY_SCENARIOS.find(item => item.id === scenarioId)!;
  const [index, setIndex] = useState(3);
  const [solver, setSolver] = useState<SolverId | "all">("baseline");
  const [preset, setPreset] = useState("desktop");
  const [playing, setPlaying] = useState(false);
  const [homes, setHomes] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [workMode, setWorkMode] = useState<"adjacent" | "attached">("adjacent");
  const [homeRequest, setHomeRequest] = useState(0);
  const [followRequest, setFollowRequest] = useState(0);
  const [reset, setReset] = useState(0);
  const [report, setReport] = useState<unknown>();
  const [measuring, setMeasuring] = useState(false);
  const current = scenario.steps[Math.min(index, scenario.steps.length - 1)]!;
  useEffect(() => {
    if (!playing || index === scenario.steps.length - 1) { setPlaying(false); return; }
    const timer = setTimeout(() => setIndex(step => step + 1), 4200); return () => clearTimeout(timer);
  }, [playing, index, scenario]);
  const evaluate = async () => {
    setMeasuring(true);
    const rows: unknown[] = [];
    try {
      const currentSurface = document.querySelector<HTMLElement>(".choreo-surface")!;
      for (const size of [{ width: currentSurface.clientWidth, height: currentSurface.clientHeight }]) {
        for (const implementation of SOLVERS) {
          for (const input of CHOREOGRAPHY_SCENARIOS) {
            let geometry = emptyHomes();
            const original: Record<string, Point> = {};
            for (const [step, accepted] of input.steps.entries()) {
              const scene = teachingScene(accepted);
              try {
                const result = await prepareTeachingFrame(scene, geometry, size, implementation.id, workMode);
                geometry = result.homes;
                for (const [id, point] of Object.entries(geometry.positions)) original[id] ??= { ...point };
                const frame = result.frame;
                const compact = size.width < 600;
                const metrics = compositionMetrics(frame.scene.items.filter(item => item.visible).map(item => ({ id: item.id,
                  home: geometry.positions[item.id], position: frame.positions[item.id] ?? geometry.positions[item.id] ?? { x: 0, y: 0 },
                  ...frame.sizes[item.id]!, fontSize: teachingFont(item, compact), minimumFontSize: minimumFont(item, compact), required: frame.scene.required.includes(item.id) })),
                  frame.scene.edges, readableRegion(size), GAP, 1, original, geometry.positions);
                rows.push({ solver: implementation.id, scenario: input.id, step, label: accepted.label, surface: size,
                  framing: scene.framing, candidateOnlyDuringPreserve: scene.preserve, workMode, ...metrics,
                  layoutMs: frame.solveMs, measurementMs: result.measurementMs, measuredBoxes: frame.sizes, notes: frame.notes });
              } catch (error) { rows.push({ solver: implementation.id, scenario: input.id, step, surface: size, error: String(error) }); }
            }
          }
        }
      }
      setReport({ generatedAt: new Date().toISOString(), type: "Measured candidate compositions; held-state behavior is tested separately", rows });
    } finally { setMeasuring(false); }
  };
  return <main className="choreo-app" data-preset={preset}>
    <header className="choreo-header"><div><strong>CueLayer</strong><span>Teaching choreography · M4B prototype</span></div><a href="/dev/m4b-canvas?design=2" target="_blank" rel="noreferrer">Existing Option 2 ↗</a></header>
    <details className="choreo-settings"><summary>Settings</summary><div className="choreo-toolbar">
      <label>Scenario<select aria-label="Scenario" value={scenarioId} onChange={event => { setScenarioId(event.target.value); setIndex(0); setPlaying(false); }}>
        {CHOREOGRAPHY_SCENARIOS.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select></label>
      <label>Viewport<select aria-label="Viewport" value={preset} onChange={event => setPreset(event.target.value)}><option value="desktop">1280 × 720</option><option value="narrow">390 × 844</option></select></label>
      <label>Work<select aria-label="Work placement" value={workMode} onChange={event => setWorkMode(event.target.value as typeof workMode)}><option value="adjacent">Adjacent transient</option><option value="attached">Solver attached</option></select></label>
    </div>
    <div className="choreo-toggles"><label><input type="checkbox" checked={homes} onChange={event => setHomes(event.target.checked)} /> Show home positions</label>
      <label><input type="checkbox" checked={diagnostics} onChange={event => setDiagnostics(event.target.checked)} /> Diagnostics</label>
      <label><input type="checkbox" checked={reduced} onChange={event => setReduced(event.target.checked)} /> Reduced motion</label></div></details>
    <div className="choreo-step"><span>{index + 1}/{scenario.steps.length} · {current.label}</span><small>{current.projection.transition.framing} · {current.projection.projector}</small></div>
    <div className="choreo-panes" data-comparison={solver === "all"}>
      {(solver === "all" ? SOLVERS : SOLVERS.filter(item => item.id === solver)).map(item => <ReactFlowProvider key={`${scenarioId}:${item.id}:${reset}`}>
        <CanvasPane step={current} solver={item.id} homesVisible={homes} diagnostics={diagnostics} reduced={reduced} workMode={workMode} homeRequest={homeRequest} followRequest={followRequest} />
      </ReactFlowProvider>)}
    </div>
    <footer className="choreo-footer"><div>
      <button onClick={() => { setIndex(0); setReset(n => n + 1); setPlaying(false); }}>Reset</button>
      <button onClick={() => { setIndex(n => Math.max(0, n - 1)); setPlaying(false); }} disabled={index === 0}>Previous</button>
      <button onClick={() => { setIndex(n => Math.min(scenario.steps.length - 1, n + 1)); setPlaying(false); }} disabled={index === scenario.steps.length - 1}>Next</button>
      <button onClick={() => setPlaying(!playing)} disabled={index === scenario.steps.length - 1}>{playing ? "Pause" : "Play"}</button>
      <button onClick={() => setHomeRequest(n => n + 1)}>HOME</button><button onClick={() => setFollowRequest(n => n + 1)}>Follow latest</button>
    </div><small>Drag to inspect together. Presentation moves; home memory stays.</small></footer>
    <details className="choreo-report"><summary>Benchmark evidence</summary><p>{scenario.source}</p>
      <p>The measured baseline is the working compositor. Earlier solver tools remain here for reference.</p>
      <label>Benchmark solver <select aria-label="Benchmark solver" value={solver} onChange={event => setSolver(event.target.value as SolverId | "all")}>
        {SOLVERS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="all">Side by side</option>
      </select></label>
      <p>Side-by-side panes use their actual available width. Select one solver for a full projector view. Failed frames retain full typography.</p>
      <button onClick={() => void evaluate()} disabled={measuring}>{measuring ? "Measuring all scenarios…" : "Measure all scenarios"}</button>
      {report !== undefined && <pre data-testid="composition-report">{JSON.stringify(report, null, 2)}</pre>}
    </details>
  </main>;
}
