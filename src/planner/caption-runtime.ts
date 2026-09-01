import type { CaptionEpisode, CaptionRuntimeState, TransientLearnerCue } from "./contracts";

export function createInitialCaptionRuntime(): CaptionRuntimeState { return {}; }
export function activateCaption(runtime: CaptionRuntimeState, episode: CaptionEpisode): CaptionRuntimeState { return { ...runtime, current: episode }; }
export function expireCaption(runtime: CaptionRuntimeState, episodeId: string): CaptionRuntimeState { return runtime.current?.id === episodeId ? { ...runtime, current: undefined } : runtime; }
export function showLearnerCue(runtime: CaptionRuntimeState, cue: TransientLearnerCue): CaptionRuntimeState { return { ...runtime, learnerCue: cue }; }
export function expireLearnerCue(runtime: CaptionRuntimeState, cueId: string): CaptionRuntimeState { return runtime.learnerCue?.id === cueId ? { ...runtime, learnerCue: undefined } : runtime; }

/** Space moves the active subtitle into the one available kept-caption slot; a second press clears it. */
export function toggleCaptionLock(runtime: CaptionRuntimeState): CaptionRuntimeState {
  if (runtime.current) return { ...runtime, current: undefined, locked: { ...runtime.current, status: "locked", expiresAt: undefined } };
  return runtime.locked ? { ...runtime, locked: undefined } : runtime;
}
