import { MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { fxExamples } from "../examples";
import type { DisplayPolicy, EffectPlan } from "../grammar/types";
import { CaptionRenderer, planEndMs } from "../renderer/CaptionRenderer";
import { PlanInspector } from "./PlanInspector";
import { TimelineControls } from "./TimelineControls";
import { TranscriptInspector } from "./TranscriptInspector";

const treatments: Record<EffectPlan["operation"]["kind"], string[]> = {
  NONE: ["plain"], FOCUS: ["marker-sweep", "spotlight", "subtle-scale", "dim-surrounding"], RELATE: ["inline-relation", "progressive-chain", "split-contrast", "aligned-sequence"], TRANSFORM: ["replace", "shift-and-reveal", "derive-inline"],
};

export function FxLab() {
  const [selectedId, setSelectedId] = useState(fxExamples[0].id);
  const [comparison, setComparison] = useState<"plain" | "fx">("fx");
  const [currentMs, setCurrentMs] = useState(0);
  const [reducedPreview, setReducedPreview] = useState(false);
  const [displayOverride, setDisplayOverride] = useState<DisplayPolicy | null>(null);
  const userPrefersReducedMotion = useReducedMotion();
  const selected = useMemo(() => fxExamples.find((example) => example.id === selectedId) ?? fxExamples[0], [selectedId]);
  const plan = useMemo<EffectPlan>(() => ({ ...selected.candidateEffectPlan, display: displayOverride ?? selected.candidateEffectPlan.display }), [selected, displayOverride]);
  const maxMs = planEndMs(plan);
  const reduceMotion = Boolean(userPrefersReducedMotion || reducedPreview);

  useEffect(() => { setCurrentMs(0); setDisplayOverride(null); }, [selectedId]);

  function replay() {
    setComparison("fx"); setCurrentMs(0);
    window.setTimeout(() => setCurrentMs(planEndMs(plan)), 28);
  }

  return <main className="app-shell"><header className="topbar"><div><div className="eyebrow">CueLayer / caption-native lab</div><h1>Teaching Caption FX Lab</h1><p>Authoring and debugging controls sit outside the learner-visible caption stage.</p></div><div className="status-chip">Source grounded · not product UI</div></header>
    <section className="lab-grid">
      <aside className="example-list" aria-label="Example corpus"><div className="panel-label">Teaching moments</div>{fxExamples.map((example) => <button className={`operation-button ${selected.id === example.id ? "active" : ""}`} key={example.id} onClick={() => setSelectedId(example.id)} type="button"><span>{example.candidateEffectPlan.operation.kind}</span><small>{example.subject} · {example.title}</small></button>)}</aside>
      <section className="preview-panel"><div className="preview-meta"><div><div className="operation-kicker">{selected.sourceType} · {selected.subject}</div><h2>{selected.title}</h2><p>{selected.intendedLearningFunction}</p></div><div className="comparison-toggle" aria-label="Caption comparison"><button type="button" className={comparison === "plain" ? "selected" : ""} onClick={() => setComparison("plain")}>Plain</button><button type="button" className={comparison === "fx" ? "selected" : ""} onClick={() => setComparison("fx")}>FX</button></div></div>
        <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}><CaptionRenderer transcript={selected.transcript} plan={plan} currentMs={currentMs} mode={comparison} reducedMotion={reduceMotion} /></MotionConfig>
        <TimelineControls currentMs={currentMs} maxMs={maxMs} onCurrentMsChange={setCurrentMs} display={plan.display} treatmentOptions={treatments[plan.operation.kind]} onDisplayChange={(patch) => setDisplayOverride({ ...plan.display, ...patch })} onReplay={replay} reducedMotion={reducedPreview} onReducedMotionChange={setReducedPreview} />
        <TranscriptInspector transcript={selected.transcript} plan={plan} />
        <div className="case-notes"><p><strong>Student still needs to do:</strong> {selected.studentWork}</p><p><strong>Risk:</strong> {selected.risk}</p></div>
      </section>
      <PlanInspector plan={plan} />
    </section>
  </main>;
}
