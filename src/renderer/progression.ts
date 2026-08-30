import type { CaptionClip, CueTarget, EffectCue } from "../types";
import type { CaptionTimelineState } from "./timing";

export type TargetState = "pending" | "active" | "completed";

function completionPoints(clip: CaptionClip, targets: CueTarget[]): number[] {
  const wordTimes = new Map(clip.words.map((word) => [word.id, word]));
  const starts = targets.map((target) => Math.min(...target.wordIds.map((id) => wordTimes.get(id)?.startMs ?? 0)));
  const ends = targets.map((target) => Math.max(...target.wordIds.map((id) => wordTimes.get(id)?.endMs ?? 0)));
  const first = Math.min(...starts);
  const last = Math.max(...ends);
  return ends.map((end) => last === first ? 1 : (end - first) / (last - first));
}

function accumulatingStates(clip: CaptionClip, targets: CueTarget[], timeline: CaptionTimelineState): TargetState[] {
  if (timeline.phase === "hold") return targets.map(() => "completed");
  const points = completionPoints(clip, targets);
  const current = points.findIndex((point) => timeline.itemProgress < point);
  return targets.map((_, index) => index < current ? "completed" : index === current ? "active" : "pending");
}

export function relationTargetStates(clip: CaptionClip, cue: Extract<EffectCue, { kind: "RELATE" }>, timeline: CaptionTimelineState): TargetState[] {
  if (cue.relation === "contrast") return cue.targets.map(() => "active");
  return accumulatingStates(clip, cue.targets, timeline);
}

export function transformTargetStates(clip: CaptionClip, cue: Extract<EffectCue, { kind: "TRANSFORM" }>, timeline: CaptionTimelineState): [TargetState, TargetState] {
  if (timeline.phase === "hold") return ["completed", "completed"];
  const [handoffAt] = completionPoints(clip, [cue.from, cue.to]);
  return timeline.itemProgress < handoffAt ? ["active", "pending"] : ["completed", "active"];
}

export function connectorState(left: TargetState, right: TargetState): TargetState {
  if (left === "completed" && right === "completed") return "completed";
  if (left !== "pending" && right !== "pending") return "active";
  return "pending";
}
