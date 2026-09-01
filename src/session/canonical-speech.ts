import type { CanonicalSpeechSegment, CanonicalSpeechState, SpeechEvent } from "./speech-types";

export function createInitialCanonicalSpeechState(): CanonicalSpeechState {
  return { committed: [] };
}

function segmentFrom(event: Extract<SpeechEvent, { kind: "provisional" | "committed" }>, index: number): CanonicalSpeechSegment {
  return { id: `${event.kind}-${index}`, text: event.text, words: event.words };
}

/** CueLayer policy: provider finals are durable; its current partial replaces ours. */
export function applySpeechEvent(state: CanonicalSpeechState, event: SpeechEvent): CanonicalSpeechState {
  if (event.kind === "error") return state;
  if (event.kind === "provisional") return { ...state, provisional: segmentFrom(event, state.committed.length) };
  return {
    committed: [...state.committed, segmentFrom(event, state.committed.length)],
  };
}
