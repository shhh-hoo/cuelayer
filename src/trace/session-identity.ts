const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;

export type LocationLike = { href: string };
export type HistoryLike = { replaceState(data: unknown, unused: string, url?: string | URL | null): void };

export type TraceSessionIdentity = { sessionId: string; created: boolean };

function fallbackId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createTraceSessionId(randomUUID?: () => string) {
  const uuid = randomUUID?.() ?? globalThis.crypto?.randomUUID?.() ?? fallbackId();
  return `session-${uuid}`;
}

export function replaceTraceSessionId(location: LocationLike, history: HistoryLike, sessionId: string) {
  const url = new URL(location.href);
  url.searchParams.set("sessionId", sessionId);
  history.replaceState(null, "", url);
}

export function resolveTraceSessionIdentity(location: LocationLike, history: HistoryLike, randomUUID?: () => string): TraceSessionIdentity {
  const url = new URL(location.href);
  const existing = url.searchParams.get("sessionId");
  if (existing && SESSION_ID.test(existing)) return { sessionId: existing, created: false };
  const sessionId = createTraceSessionId(randomUUID);
  replaceTraceSessionId(location, history, sessionId);
  return { sessionId, created: true };
}
