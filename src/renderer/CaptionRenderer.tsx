import { motion } from "motion/react";
import type { CSSProperties } from "react";
import type { CaptionClip, CueTarget, EffectCue } from "../types";
import { captionSegments } from "./caption-segments";
import { cueTargets, phraseSegments, targetDisplayText, targetText } from "./cue-targets";
import { resolveCaptionTimeline } from "./timing";

type RendererProps = { clip: CaptionClip; cue?: EffectCue; currentMs: number; mode: "plain" | "fx"; reducedMotion: boolean; showcase?: boolean };

function PhraseUnit({ clip, target, className }: { clip: CaptionClip; target: CueTarget; className: string }) {
  return <span className={`${className} ${target.keepTogether === false ? "may-wrap" : "keep-together"}`} aria-label={targetText(clip, target)}>{targetDisplayText(clip, target)}</span>;
}

function TransformContext({ clip, target }: { clip: CaptionClip; target: CueTarget }) {
  const lastTargetWord = target.wordIds.at(-1);
  const end = clip.words.findIndex((word) => word.id === lastTargetWord);
  const text = clip.words.slice(end + 1).map((word) => word.text).join(" ");
  return text ? <span className="semantic-context"> {text}</span> : null;
}

function SemanticLayout({ clip, cue }: { clip: CaptionClip; cue: Exclude<EffectCue, { kind: "FOCUS" }> }) {
  if (cue.kind === "TRANSFORM") return <div className="semantic-layout transform-layout" aria-label={clip.captionText}><PhraseUnit clip={clip} target={cue.from} className="phrase-unit transform-phrase previous-state" /><span className="semantic-connector" aria-hidden="true">→</span><PhraseUnit clip={clip} target={cue.to} className="phrase-unit transform-phrase current-state" /><TransformContext clip={clip} target={cue.to} /></div>;
  const relationClass = cue.relation === "contrast" ? "contrast-layout" : cue.relation === "sequence" ? "sequence-layout" : "cause-layout";
  return <div className={`semantic-layout relation-layout ${relationClass}`} aria-label={clip.captionText}>{cue.targets.map((target, index) => <span className="semantic-relation-entry" key={target.id}><PhraseUnit clip={clip} target={target} className={`phrase-unit relation-phrase relation-phrase-${index + 1}`} />{index < cue.targets.length - 1 ? <span className="semantic-connector" aria-hidden="true">{cue.relation === "sequence" ? `${index + 2}` : "→"}</span> : null}</span>)}</div>;
}

function InlineCaption({ clip, cue, transition }: { clip: CaptionClip; cue?: EffectCue; transition: { duration: number; ease: "easeOut" } }) {
  if (cue?.kind !== "FOCUS") return <>{captionSegments(clip).map((segment) => <span key={segment.key} className="caption-surface">{segment.text}</span>)}</>;
  return <>{phraseSegments(clip, cueTargets(cue)).map((segment) => segment.target ? <motion.span key={segment.key} className={`phrase-unit focus-target treatment-${cue.treatment === "marker" ? "marker-sweep" : cue.treatment} ${segment.target.keepTogether === false ? "may-wrap" : "keep-together"}`} transition={transition}><span aria-label={targetText(clip, segment.target)}>{targetDisplayText(clip, segment.target)}</span></motion.span> : <span key={segment.key} className="caption-surface">{segment.text}</span>)}</>;
}

export function CaptionRenderer({ clip, cue, currentMs, mode, reducedMotion, showcase = false }: RendererProps) {
  const timeline = resolveCaptionTimeline(cue, currentMs, mode, reducedMotion);
  const activeCue = cue && mode === "fx" && timeline.emphasis > 0 ? cue : undefined;
  const transition = { duration: reducedMotion ? 0 : Math.max(0.12, (cue?.durationMs ?? 0) / 1000), ease: "easeOut" as const };
  const stageStyle = { "--cue-duration": `${cue?.durationMs ?? 0}ms` } as CSSProperties;
  const semanticCue = activeCue?.kind === "RELATE" || activeCue?.kind === "TRANSFORM" ? activeCue : undefined;
  return <section style={stageStyle} className={`stage-shell ${showcase ? "showcase-stage" : ""} operation-${cue?.kind.toLowerCase() ?? "none"} intensity-${cue?.intensity ?? "subtle"} phase-${timeline.phase}`} aria-label="Learner-visible caption stage">{showcase ? null : <div className="stage-label">Learner-visible caption stage · {mode === "plain" ? "plain captions" : timeline.phase}</div>}{semanticCue ? <SemanticLayout clip={clip} cue={semanticCue} /> : <p className="caption-line"><InlineCaption clip={clip} cue={activeCue} transition={transition} /></p>}</section>;
}
