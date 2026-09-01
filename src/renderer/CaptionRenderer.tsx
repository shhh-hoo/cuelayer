import { motion } from "motion/react";
import type { CSSProperties } from "react";
import type { CaptionClip, CueTarget, EffectCue } from "../types";
import { captionSegments } from "./caption-segments";
import { cueTargets, phraseSegments, targetDisplayText, targetText } from "./cue-targets";
import { relationTargetStates, transformTargetStates, type TargetState } from "./progression";
import { resolveCaptionTimeline } from "./timing";

type RendererProps = { clip: CaptionClip; cue?: EffectCue; currentMs: number; mode: "plain" | "fx"; reducedMotion: boolean; showcase?: boolean; embedded?: boolean };

function targetClass(cue: EffectCue, target: CueTarget, state?: TargetState) {
  const wrapping = target.keepTogether === false ? "may-wrap" : "keep-together";
  if (cue.kind === "FOCUS") return `phrase-unit focus-target treatment-${cue.treatment === "marker" ? "marker-sweep" : cue.treatment} ${wrapping}`;
  if (cue.kind === "RELATE") {
    const index = cue.targets.findIndex((item) => item.id === target.id);
    return `phrase-unit relation-item relation-item-${index + 1} treatment-${cue.treatment} target-${state ?? "pending"} ${wrapping}`;
  }
  const isFrom = cue.from.id === target.id;
  return `phrase-unit ${isFrom ? "previous-state" : "current-state"} treatment-${cue.treatment} target-${state ?? "pending"} ${wrapping}`;
}

function InlineCaption({ clip, cue, transition, timeline }: { clip: CaptionClip; cue?: EffectCue; transition: { duration: number; ease: "easeOut" }; timeline: ReturnType<typeof resolveCaptionTimeline> }) {
  if (!cue) return <>{captionSegments(clip).map((segment) => <span key={segment.key} className="caption-surface">{segment.text}</span>)}</>;
  const targets = cueTargets(cue);
  const states = cue.kind === "FOCUS" ? [] : cue.kind === "RELATE" ? relationTargetStates(clip, cue, timeline) : transformTargetStates(clip, cue, timeline);
  const statesByTarget = new Map(targets.map((target, index) => [target.id, states[index]]));
  return <>{phraseSegments(clip, targets).map((segment) => segment.target
    ? <motion.span key={segment.key} className={targetClass(cue, segment.target, statesByTarget.get(segment.target.id))} transition={transition}><span aria-label={targetText(clip, segment.target)}>{targetDisplayText(clip, segment.target)}</span></motion.span>
    : <span key={segment.key} className="caption-surface">{segment.text}</span>)}</>;
}

export function CaptionRenderer({ clip, cue, currentMs, mode, reducedMotion, showcase = false, embedded = false }: RendererProps) {
  const timeline = resolveCaptionTimeline(cue, currentMs, mode, reducedMotion);
  const activeCue = cue && mode === "fx" && timeline.emphasis > 0 ? cue : undefined;
  const transition = { duration: reducedMotion ? 0 : Math.max(0.12, (cue?.durationMs ?? 0) / 1000), ease: "easeOut" as const };
  const stageStyle = { "--cue-duration": `${cue?.durationMs ?? 0}ms` } as CSSProperties;
  return <section style={stageStyle} className={`stage-shell ${showcase ? "showcase-stage" : ""} ${embedded ? "embedded-caption-stage" : ""} operation-${cue?.kind.toLowerCase() ?? "none"} intensity-${cue?.intensity ?? "subtle"} phase-${timeline.phase}`} aria-label="Learner-visible caption stage">{showcase || embedded ? null : <div className="stage-label">Learner-visible caption stage · {mode === "plain" ? "plain captions" : timeline.phase}</div>}<p className="caption-line"><InlineCaption clip={clip} cue={activeCue} transition={transition} timeline={timeline} /></p></section>;
}
