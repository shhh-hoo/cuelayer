import { compareTraceEvents, type DurableTraceEvent } from "./durable-trace";
import type { LocalTraceSession } from "./session-store";

export type DiagnosticBundle = Readonly<{ session: Readonly<LocalTraceSession>; events: readonly DurableTraceEvent[] }>;
export type DiagnosticUploadResult = { supportSessionId: string };
export interface DiagnosticSink { upload(bundle: DiagnosticBundle): Promise<DiagnosticUploadResult>; }

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

/** Produces an immutable, serializable completed-session handoff with no configured remote sink. */
export function diagnosticBundle(session: LocalTraceSession, events: DurableTraceEvent[]): DiagnosticBundle {
  const clonedSession = structuredClone(session);
  const clonedEvents = structuredClone(events).sort(compareTraceEvents);
  return deepFreeze({ session: clonedSession, events: clonedEvents });
}
