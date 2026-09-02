import type { SessionAction, SessionState } from "./session-types";
import { createInitialSessionState, sessionReducer } from "./session-state";

export type SessionPageAction = SessionAction | { type: "restart-session" };

/**
 * A new product session must reset canonical speech, planner runtime, and the
 * legacy development trace together. Keeping this page-level boundary avoids
 * teaching a generic domain reducer about URL/trace lifecycle concerns.
 */
export function createSessionPageReducer(traceEnabled: boolean) {
  return (state: SessionState, action: SessionPageAction): SessionState => {
    if (action.type === "restart-session") return createInitialSessionState(traceEnabled);
    return sessionReducer(state, action);
  };
}
