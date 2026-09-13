import {
  Component,
  createContext,
  lazy,
  Suspense,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Tldraw,
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  createShapeId,
  Box,
  type TLBaseShape,
  type Editor,
} from "tldraw";
import "tldraw/tldraw.css";
import type { TeachingState, Unit } from "../contract";
import { candidates, Geography, type Frame } from "../display";
import { Notation } from "./notation";
import type { Trace } from "./trace";
const FunctionPlot = lazy(() => import("./plot"));
const RenderContext = createContext<{
  state: TeachingState;
  fail: boolean;
  selected: string[];
  mode?: Frame["mode"];
}>({ state: {} as TeachingState, fail: false, selected: [] });
declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    knowledge: {
      w: number;
      h: number;
      unitId: string;
      form: string;
      revision: number;
    };
  }
}
type KnowledgeShape = TLBaseShape<
  "knowledge",
  { w: number; h: number; unitId: string; form: string; revision: number }
>;
class Boundary extends Component<
  { children: ReactNode; token: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(previous: { token: string }) {
    if (previous.token !== this.props.token && this.state.failed)
      this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? (
      <p role="alert">
        Representation unavailable. Accepted meaning is retained.
      </p>
    ) : (
      this.props.children
    );
  }
}
function Artifact({ shape }: { shape: KnowledgeShape }) {
  const { state, fail, selected, mode } = useContext(RenderContext),
    unit = state.units[shape.props.unitId];
  if (!unit?.valid) return null;
  const m = unit.meaning;
  return (
    <HTMLContainer style={{ width: shape.props.w, height: shape.props.h }}>
      <article
        className={`knowledge ${selected.includes(unit.id) ? "selected" : "historical"}`}
        data-role={
          mode === "FOCUS" && selected[0] !== unit.id ? "context" : "primary"
        }
        data-unit={unit.id}
        data-version={unit.version}
        data-form={shape.props.form}
      >
        <Boundary token={`${unit.version}:${fail}`}>
          <Content unit={unit} fail={fail} form={shape.props.form} />
        </Boundary>
      </article>
    </HTMLContainer>
  );
}
function Content({
  unit,
  fail,
  form,
}: {
  unit: Unit;
  fail: boolean;
  form: string;
}) {
  const { state } = useContext(RenderContext);
  if (fail)
    return (
      <p role="alert">
        Representation unavailable. Accepted meaning is retained.
      </p>
    );
  const m = unit.meaning;
  return (
    <>
      <div className="artifact-eyebrow">
        {m.kind === "quantity"
          ? "QUANTITATIVE RELATIONSHIP"
          : m.kind === "reaction"
            ? "CHEMICAL EQUILIBRIUM"
            : m.kind === "annotation"
              ? "CONNECTION"
              : "ESTABLISHED IDEA"}
      </div>
      {m.kind === "quantity" || m.kind === "reaction" ? (
        <>
          <Notation meaning={m} />
          {m.kind === "quantity" && form === "plot" ? (
            <Suspense fallback={<p>Preparing plot…</p>}>
              <FunctionPlot meaning={m} />
            </Suspense>
          ) : null}
          {m.kind === "quantity" && form !== "plot" ? (
            <dl>
              {Object.entries(m.symbols).map(([symbol, binding]) => (
                <div key={symbol}>
                  <dt>{symbol}</dt>
                  <dd>
                    {binding.label} <span>· {binding.unit}</span>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div className="conditions">{m.conditions.join(" · ")}</div>
        </>
      ) : m.kind === "relation" ? (
        <section className="relation-structure" data-relation={m.relation}>
          <p>{m.text}</p>
          <ul>
            {m.targets.map((id) => {
              const target = state.units[id]?.meaning;
              const symbol =
                target?.kind === "quantity" && Array.isArray(target.expression)
                  ? target.expression[1]
                  : null;
              const label =
                target?.kind === "quantity" && typeof symbol === "string"
                  ? target.symbols[symbol]?.label
                  : id;
              return <li key={id}>{label}</li>;
            })}
          </ul>
        </section>
      ) : (
        <p className={m.kind === "annotation" ? "annotation" : "statement"}>
          {m.text}
        </p>
      )}
    </>
  );
}
class KnowledgeShapeUtil extends BaseBoxShapeUtil<KnowledgeShape> {
  static override type = "knowledge" as const;
  static override props = {
    w: T.number,
    h: T.number,
    unitId: T.string,
    form: T.string,
    revision: T.number,
  };
  getDefaultProps() {
    return { w: 320, h: 260, unitId: "", form: "text", revision: 0 };
  }
  override canResize() {
    return false;
  }
  override canEdit() {
    return false;
  }
  component(shape: KnowledgeShape) {
    return <Artifact shape={shape} />;
  }
  getIndicatorPath(shape: KnowledgeShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}
const utils = [KnowledgeShapeUtil];
export type CanvasHandle = {
  editor: Editor | null;
  geography: Geography;
  inspection: boolean;
  frame: Frame | null;
  follow: () => void;
};
export function Board({
  state,
  frame,
  trace,
  fail,
  handle,
}: {
  state: TeachingState;
  frame: Frame;
  trace: Trace;
  fail: boolean;
  handle: CanvasHandle;
}) {
  const container = useRef<HTMLDivElement>(null),
    [editor, setEditor] = useState<Editor | null>(null),
    [size, setSize] = useState({ w: 1000, h: 650 });
  const [inspection, setInspection] = useState(false),
    [followVersion, setFollowVersion] = useState(0),
    [degraded, setDegraded] = useState<string | null>(null);
  const geography = useRef(handle.geography);
  handle.editor = editor;
  handle.inspection = inspection;
  handle.frame = frame;
  handle.follow = () => {
    setInspection(false);
    setFollowVersion((v) => v + 1);
  };
  useLayoutEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!editor) return;
    const started = performance.now();
    geography.current.reconcile(state);
    const active = new Map(frame.selected.map((c) => [c.unitId, c]));
    const selected = frame.selected;
    const narrow = size.w < 688;
    const heights = new Map(
      Object.values(state.units).map((u) => [
        u.id,
        candidates(u).at(-1)?.form === "plot" ? 380 : 260,
      ]),
    );
    let y = 0;
    const positions = new Map(
      selected.map((c, i) => {
        const h = heights.get(c.unitId)!;
        const home = geography.current.homes.get(c.unitId)!;
        const pos =
          frame.mode === "WIDEN"
            ? { x: home.x, y: home.y, w: 320, h }
            : {
                x: -1800 + (narrow ? 0 : i * 344),
                y: narrow ? y : 0,
                w: 320,
                h,
              };
        y += h + 16;
        return [c.unitId, pos] as const;
      }),
    );
    const valid = Object.values(state.units).filter((u) => u.valid);
    const ids = new Set(valid.map((u) => createShapeId(u.id)));
    editor.run(
      () => {
        editor.updateInstanceState({ isReadonly: false });
        try {
          editor.deleteShapes(
            editor
              .getCurrentPageShapes()
              .filter((s) => !ids.has(s.id))
              .map((s) => s.id),
          );
          for (const unit of valid) {
            const home = geography.current.homes.get(unit.id)!,
              candidate = active.get(unit.id) ?? candidates(unit).at(-1)!;
            const position = positions.get(unit.id) ?? {
              ...home,
              w: 320,
              h: heights.get(unit.id)!,
            };
            const value = {
              id: createShapeId(unit.id),
              type: "knowledge" as const,
              x: position.x,
              y: position.y,
              props: {
                w: position.w,
                h: position.h,
                unitId: unit.id,
                form: candidate.form,
                revision: unit.version,
              },
            };
            if (editor.getShape(value.id)) editor.updateShape(value);
            else editor.createShape(value);
          }
        } finally {
          editor.updateInstanceState({ isReadonly: true });
        }
      },
      { history: "ignore" },
    );
    const boxes = [...positions.values()].map(
      (p) => new Box(p.x, p.y, p.w, p.h),
    );
    let reason = frame.degraded;
    if (boxes.length && !inspection) {
      const bounds = Box.Common(boxes),
        fits = bounds.w + 24 <= size.w && bounds.h + 24 <= size.h;
      if (!fits) reason = "This frame exceeds the supported readable area.";
      else {
        trace.mark("camera-command", {
          revision: state.revision,
          mode: frame.mode,
        });
        editor.zoomToBounds(bounds, {
          inset: 12,
          targetZoom: 1,
          animation: {
            duration: matchMedia("(prefers-reduced-motion: reduce)").matches
              ? 0
              : 180,
          },
        });
      }
    }
    setDegraded(reason);
    trace.mark(
      "render",
      { revision: state.revision, mode: frame.mode, inspection, reason },
      started,
    );
    let observed = false,
      raf = 0;
    const observe = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (observed || !container.current) return;
        const safe = container.current.getBoundingClientRect();
        const visible = frame.targets.filter((id) => {
          const node = container.current!.querySelector(`[data-unit="${id}"]`),
            rect = node?.getBoundingClientRect();
          const notation = node?.querySelector(".notation");
          const ready =
            !notation || notation.getAttribute("data-ready") === "true";
          const plotReady =
            active.get(id)?.form !== "plot" ||
            Boolean(node?.querySelector("[data-plot] svg"));
          return (
            rect &&
            rect.left >= safe.left - 1 &&
            rect.right <= safe.right + 1 &&
            rect.top >= safe.top - 1 &&
            rect.bottom <= safe.bottom + 1 &&
            ready &&
            plotReady &&
            !node?.querySelector('[role="alert"]')
          );
        });
        if (
          visible.length === frame.targets.length &&
          visible.length &&
          !reason
        ) {
          observed = true;
          trace.mark(
            "learner-visible-dom",
            {
              revision: state.revision,
              targets: visible,
              required: frame.targets,
              complete: true,
            },
            started,
          );
        }
      });
    };
    const observer = new MutationObserver(observe);
    observer.observe(container.current!, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    observe();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [editor, state, frame, size, inspection, followVersion, trace]);
  const inspect = () => {
    if (editor) {
      editor.stopCameraAnimation();
      setInspection(true);
    }
  };
  return (
    <RenderContext.Provider
      value={{ state, fail, selected: frame.targets, mode: frame.mode }}
    >
      <div
        className="board"
        ref={container}
        data-testid="board"
        onPointerDownCapture={inspect}
        onWheelCapture={inspect}
      >
        <Tldraw
          hideUi
          shapeUtils={utils}
          onMount={(e) => {
            e.setCurrentTool("hand");
            e.user.updateUserPreferences({
              animationSpeed: matchMedia("(prefers-reduced-motion: reduce)")
                .matches
                ? 0
                : 1,
            });
            e.updateInstanceState({ isReadonly: true });
            setEditor(e);
          }}
        />
        {degraded ? (
          <div className="degraded" role="status">
            {degraded}
          </div>
        ) : null}
      </div>
      {inspection ? (
        <button className="follow" onClick={handle.follow}>
          Follow Teaching
        </button>
      ) : null}
    </RenderContext.Provider>
  );
}
