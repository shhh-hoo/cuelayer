import type { SessionAction, SessionState } from "./session-types";
import { applySpeechEvent, createInitialCanonicalSpeechState } from "./canonical-speech";

export function createInitialSessionState(): SessionState {
  return {
    status: "idle",
    presentation: { status: "empty", stream: null },
    speech: { status: "off", canonical: createInitialCanonicalSpeechState(), debug: { runId: 0, provisionalEvents: 0, committedEvents: 0 } },
  };
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "begin-capture":
      if (state.presentation.status === "starting" || state.presentation.status === "ready") return state;
      return { ...state, status: state.status === "paused" ? "paused" : "active", presentation: { status: "starting", stream: null } };
    case "capture-ready":
      if (state.presentation.status !== "starting" || state.status === "idle" || state.status === "ended") return state;
      return { ...state, presentation: { status: "ready", stream: action.stream } };
    case "capture-failed":
      if (state.status === "idle" || state.status === "ended") return state;
      return { ...state, presentation: { status: "error", stream: null, error: action.error } };
    case "capture-ended":
      if (state.status === "idle" || state.status === "ended") return state;
      return { ...state, presentation: { status: "ended", stream: null } };
    case "begin-speech":
      if (state.status === "ended" || state.status === "paused" || state.speech.status === "starting" || state.speech.status === "ready") return state;
      return {
        ...state,
        status: "active",
        speech: { status: "starting", canonical: createInitialCanonicalSpeechState(), debug: { runId: action.runId, provisionalEvents: 0, committedEvents: 0 } },
      };
    case "speech-ready":
      if (state.speech.debug.runId !== action.runId || state.speech.status !== "starting" || state.status !== "active") return state;
      return { ...state, speech: { ...state.speech, status: "ready" } };
    case "speech-event": {
      if (state.speech.debug.runId !== action.runId || state.status !== "active") return state;
      if (action.event.kind === "error" && (state.speech.status === "starting" || state.speech.status === "ready")) return { ...state, speech: { ...state.speech, status: "error", error: { code: action.event.code, message: action.event.message }, debug: { ...state.speech.debug, lastError: { code: action.event.code, message: action.event.message } } } };
      if (state.speech.status !== "ready") return state;
      const eventCount = action.event.kind === "provisional" ? { provisionalEvents: state.speech.debug.provisionalEvents + 1 } : { committedEvents: state.speech.debug.committedEvents + 1 };
      return { ...state, speech: { ...state.speech, canonical: applySpeechEvent(state.speech.canonical, action.event), debug: { ...state.speech.debug, ...eventCount } } };
    }
    case "speech-paused":
      if (state.speech.debug.runId !== action.runId || state.speech.status !== "ready") return state;
      return { ...state, speech: { ...state.speech, status: "paused", canonical: { ...state.speech.canonical, provisional: undefined } } };
    case "speech-resumed":
      if (state.speech.debug.runId !== action.runId || state.speech.status !== "paused" || state.status !== "active") return state;
      return { ...state, speech: { ...state.speech, status: "ready" } };
    case "speech-stopped":
      if (state.speech.debug.runId !== action.runId) return state;
      return { ...state, speech: { ...state.speech, status: "ended", canonical: { ...state.speech.canonical, provisional: undefined } } };
    case "pause":
      return state.status === "active" ? { ...state, status: "paused", speech: state.speech.status === "ready" ? { ...state.speech, status: "paused", canonical: { ...state.speech.canonical, provisional: undefined } } : state.speech } : state;
    case "resume":
      return state.status === "paused" ? { ...state, status: "active", speech: state.speech.status === "paused" ? { ...state.speech, status: "ready" } : state.speech } : state;
    case "end":
      return { ...state, status: "ended", presentation: { status: "ended", stream: null }, speech: { ...state.speech, status: "ended", canonical: { ...state.speech.canonical, provisional: undefined } } };
  }
}
