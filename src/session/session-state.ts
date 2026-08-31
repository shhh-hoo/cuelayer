import type { SessionAction, SessionState } from "./session-types";

export function createInitialSessionState(): SessionState {
  return { status: "idle", presentation: { status: "empty", stream: null } };
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "begin-capture":
      if (state.presentation.status === "starting" || state.presentation.status === "ready") return state;
      return { status: state.status === "paused" ? "paused" : "active", presentation: { status: "starting", stream: null } };
    case "capture-ready":
      if (state.presentation.status !== "starting" || state.status === "idle" || state.status === "ended") return state;
      return { ...state, presentation: { status: "ready", stream: action.stream } };
    case "capture-failed":
      if (state.status === "idle" || state.status === "ended") return state;
      return { ...state, presentation: { status: "error", stream: null, error: action.error } };
    case "capture-ended":
      if (state.status === "idle" || state.status === "ended") return state;
      return { ...state, presentation: { status: "ended", stream: null } };
    case "pause":
      return state.status === "active" ? { ...state, status: "paused" } : state;
    case "resume":
      return state.status === "paused" ? { ...state, status: "active" } : state;
    case "end":
      return { status: "ended", presentation: { status: "ended", stream: null } };
  }
}
