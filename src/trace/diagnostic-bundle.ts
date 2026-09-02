import { compareTraceEvents, type DurableTraceEvent } from "./durable-trace";
import type { LocalTraceSession } from "./session-store";

export type DiagnosticBundle = Readonly<{ session: Readonly<LocalTraceSession>; events: readonly DurableTraceEvent[] }>;
export type DiagnosticUploadResult = { supportSessionId: string };
export interface DiagnosticSink { upload(bundle: DiagnosticBundle): Promise<DiagnosticUploadResult>; }

/** Produces an immutable, serializable completed-session handoff with no configured remote sink. */
export function diagnosticBundle(session: LocalTraceSession, events: DurableTraceEvent[]): DiagnosticBundle {
  return Object.freeze({ session: Object.freeze({ ...session }), events: Object.freeze([...events].sort(compareTraceEvents).map((event) => Object.freeze({ ...event }))) });
}
