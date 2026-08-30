import { MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fxExamples } from "../examples/cases";
import type { EffectCue } from "../types";
import { CaptionRenderer } from "../renderer/CaptionRenderer";
import { cueEndMs, playbackEndMs } from "../renderer/timing";
import { PlanInspector } from "./PlanInspector";
import { TimelineControls } from "./TimelineControls";

const treatments: Record<EffectCue["kind"], string[]> = {
  FOCUS: ["marker", "spotlight", "scale", "dim-surrounding"], RELATE: ["chain", "ordered-steps", "split-contrast"], TRANSFORM: ["replace", "derive", "state-change"],
};

export function FxLab() {
  const [selectedId, setSelectedId] = useState(fxExamples[0].id);
  const [comparison, setComparison] = useState<"plain" | "fx">("fx");
  const [currentMs, setCurrentMs] = useState(0);
  const [reducedPreview, setReducedPreview] = useState(false);
  const [cueOverride, setCueOverride] = useState<EffectCue | null>(null);
  const animationFrame = useRef<number | null>(null);
  const userPrefersReducedMotion = useReducedMotion();
  const selected = useMemo(() => fxExamples.find((example) => example.id === selectedId) ?? fxExamples[0], [selectedId]);
  const cue = cueOverride ?? selected.clip.cues[0];
  const maxMs = cueEndMs(cue);
  const reduceMotion = Boolean(userPrefersReducedMotion || reducedPreview);

  useEffect(() => { setCurrentMs(0); setCueOverride(null); }, [selectedId]);
  useEffect(() => () => { if (animationFrame.current !== null) window.cancelAnimationFrame(animationFrame.current); }, []);

  function stopPlayback() {
    if (animationFrame.current !== null) window.cancelAnimationFrame(animationFrame.current);
    animationFrame.current = null;
  }

  function replay() {
    stopPlayback();
    setComparison("fx");
    setCurrentMs(0);
    const startedAt = window.performance.now();
    const endMs = playbackEndMs(cue);
    const tick = (now: number) => {
      const elapsed = Math.min(endMs, now - startedAt);
      setCurrentMs(elapsed);
      if (elapsed < endMs) animationFrame.current = window.requestAnimationFrame(tick);
      else animationFrame.current = null;
    };
    animationFrame.current = window.requestAnimationFrame(tick);
  }

  return <main className="app-shell"><header className="topbar"><div><div className="eyebrow">CueLayer / FX engine v0</div><h1>Teaching Caption FX Lab</h1><p>Compare the same authored caption with and without a restrained teaching effect.</p></div><div className="status-chip">Authoring lab · not product UI</div></header>
    <section className="lab-grid">
      <aside className="example-list" aria-label="Example corpus"><div className="panel-label">Teaching moments</div>{fxExamples.map((example) => <button className={`operation-button ${selected.id === example.id ? "active" : ""}`} key={example.id} onClick={() => setSelectedId(example.id)} type="button"><span>{example.clip.cues[0]?.kind ?? "NONE"}</span><small>{example.subject} · {example.title}</small></button>)}</aside>
      <section className="preview-panel"><div className="preview-meta"><div><div className="operation-kicker">{selected.subject}</div><h2>{selected.title}</h2><p>{selected.learningFunction}</p></div><div className="comparison-toggle" aria-label="Caption comparison"><button type="button" className={comparison === "plain" ? "selected" : ""} onClick={() => setComparison("plain")}>Plain</button><button type="button" className={comparison === "fx" ? "selected" : ""} onClick={() => setComparison("fx")}>FX</button></div></div>
        <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}><CaptionRenderer clip={selected.clip} cue={cue} currentMs={currentMs} mode={comparison} reducedMotion={reduceMotion} /></MotionConfig>
        <TimelineControls currentMs={currentMs} maxMs={Math.max(maxMs, playbackEndMs(cue))} onCurrentMsChange={(value) => { stopPlayback(); setCurrentMs(value); }} cue={cue} treatmentOptions={cue ? treatments[cue.kind] : []} onCueChange={(patch) => cue && setCueOverride({ ...cue, ...patch } as EffectCue)} onReplay={replay} reducedMotion={reducedPreview} onReducedMotionChange={setReducedPreview} />
        <div className="case-notes"><p><strong>Risk:</strong> {selected.risk}</p></div>
      </section>
      <PlanInspector clip={selected.clip} cue={cue} />
    </section>
  </main>;
}
