import type { SessionAction, SessionState } from "./session-types";
import { createInitialSessionState, sessionReducer } from "./session-state";

export type SessionPageAction = SessionAction | { type: "restart-session" };

/**
 * A new product session resets only page-owned speech and presentation state.
 * Durable trace and lesson-stream state own their lifecycles independently.
 */
export function createSessionPageReducer() {
  return (state: SessionState, action: SessionPageAction): SessionState => {
    if (action.type === "restart-session") return createInitialSessionState();
    return sessionReducer(state, action);
  };
}
