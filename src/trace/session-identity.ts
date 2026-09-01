const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;

type LocationLike = { href: string };
type HistoryLike = { replaceState(data: unknown, unused: string, url?: string | URL | null): void };

export type TraceSessionIdentity = { sessionId: string; isNew: boolean };

export function createSessionId(randomUUID: () => string = () => crypto.randomUUID()) {
  return `session-${randomUUID()}`;
}

export function resolveTraceSession(location: LocationLike, history: HistoryLike, randomUUID?: () => string): TraceSessionIdentity {
  const url = new URL(location.href);
  const existing = url.searchParams.get("sessionId");
  if (existing && SESSION_ID.test(existing)) return { sessionId: existing, isNew: false };
  const sessionId = createSessionId(randomUUID);
  url.searchParams.set("sessionId", sessionId);
  history.replaceState(null, "", url);
  return { sessionId, isNew: true };
}
