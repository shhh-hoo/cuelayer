import type { EffectPlan, Transcript } from "../grammar/types";

function targetIds(plan: EffectPlan) {
  if (plan.operation.kind === "FOCUS") return new Set(plan.operation.targets.flatMap((span) => span.tokenIds));
  if (plan.operation.kind === "RELATE") return new Set(plan.operation.items.flatMap((span) => span.tokenIds));
  if (plan.operation.kind === "TRANSFORM") return new Set([...plan.operation.from.tokenIds, ...plan.operation.to.tokenIds]);
  return new Set<string>();
}

export function TranscriptInspector({ transcript, plan }: { transcript: Transcript; plan: EffectPlan }) {
  const ids = targetIds(plan);
  return <section className="transcript-inspector"><div className="panel-label">Source transcript · targets identified</div><p>{transcript.tokens.map((token) => <span key={token.id} className={ids.has(token.id) ? "inspected-target" : ""}>{token.text}{" "}</span>)}</p></section>;
}
