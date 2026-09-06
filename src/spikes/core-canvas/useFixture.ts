import { useEffect, useReducer } from "react";
import { initialPlayback, playbackReducer, STEPS } from "./fixture";

export function useFixture() {
  const [playback, dispatch] = useReducer(playbackReducer, undefined, initialPlayback);
  useEffect(() => {
    if (!playback.playing) return;
    const timer = window.setTimeout(() => dispatch({ type: "tick" }), STEPS[playback.index]!.holdMs);
    return () => window.clearTimeout(timer);
  }, [playback.index, playback.playing, playback.resetKey]);
  return { playback, dispatch };
}
