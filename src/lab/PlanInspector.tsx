import type { CaptionSpanRef, EffectPlan } from "../grammar/types";

function spansForPlan(plan: EffectPlan): CaptionSpanRef[] {
  if (plan.operation.kind === "FOCUS") return plan.operation.targets;
  if (plan.operation.kind === "RELATE") return plan.operation.items;
  if (plan.operation.kind === "TRANSFORM") return [plan.operation.from, plan.operation.to];
  return [];
}

export function PlanInspector({ plan }: { plan: EffectPlan }) {
  const spans = spansForPlan(plan);
  return <aside className="inspector-panel"><div className="panel-label">Current effect plan</div><dl>
    <div><dt>Operation</dt><dd>{plan.operation.kind}</dd></div>
    {plan.operation.kind === "RELATE" ? <><div><dt>Relation</dt><dd>{plan.operation.relation}</dd></div><div><dt>Reveal</dt><dd>{plan.operation.reveal}</dd></div></> : null}
    {plan.operation.kind === "TRANSFORM" ? <div><dt>Mode</dt><dd>{plan.operation.mode}</dd></div> : null}
    <div><dt>Treatment</dt><dd>{plan.display.treatmentId}</dd></div><div><dt>Intensity</dt><dd>{plan.display.intensity}</dd></div><div><dt>Timing</dt><dd>{plan.display.startMs} / {plan.display.durationMs} / {plan.display.holdMs} ms</dd></div><div><dt>Decay</dt><dd>{plan.display.decay}</dd></div>
  </dl><div className="span-list"><span className="panel-label">Grounded caption spans</span>{spans.length ? spans.map((span) => <code key={`${span.fragmentId}-${span.startOffset}`}>{span.exactText}</code>) : <p>None — plain caption is the default.</p>}</div></aside>;
}
