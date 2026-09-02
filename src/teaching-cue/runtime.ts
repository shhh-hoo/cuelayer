import type { ActiveTeachingCue, TeachingCueDraft, TeachingCueState } from "./contracts";

export const DEFAULT_NOTE_DURATION_MS = 4_000;

export type TeachingCueAction =
  | { type: "set"; cue: TeachingCueDraft; now: number }
  | { type: "resolve"; cueId: string }
  | { type: "expire"; cueId: string; now: number }
  | { type: "clear" };

export function createInitialTeachingCueState(): TeachingCueState {
  return {};
}

function normalizedText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function activeCue(cue: TeachingCueDraft, now: number): ActiveTeachingCue | undefined {
  const text = normalizedText(cue.text);
  if (!text) return undefined;
  const durationMs = cue.durationMs ?? (cue.kind === "NOTE" ? DEFAULT_NOTE_DURATION_MS : undefined);
  return {
    id: cue.id,
    kind: cue.kind,
    text,
    sourceSegmentIds: cue.sourceSegmentIds ?? [],
    activatedAt: now,
    ...(durationMs === undefined ? {} : { expiresAt: now + Math.max(0, durationMs) }),
  };
}

/**
 * Teaching Cue is state, not a board effect. Setting a new cue replaces the old
 * active cue; persistent cues leave only through explicit resolution/replacement.
 */
export function teachingCueReducer(state: TeachingCueState, action: TeachingCueAction): TeachingCueState {
  switch (action.type) {
    case "set": {
      const next = activeCue(action.cue, action.now);
      return next ? { active: next } : state;
    }
    case "resolve":
      return state.active?.id === action.cueId ? {} : state;
    case "expire":
      return state.active?.id === action.cueId && state.active.expiresAt !== undefined && action.now >= state.active.expiresAt ? {} : state;
    case "clear":
      return {};
  }
}
