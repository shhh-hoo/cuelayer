import { describe, expect, it } from "vitest";
import { beginNewTraceSession, resolveTraceSession } from "./session-identity";

describe("trace session identity", () => {
  it("retains a teaching session across reloads and creates a new identity for Start another session", () => {
    let href = "https://example.test/session";
    const history = { replaceState(_data: unknown, _unused: string, url?: string | URL | null) { href = String(url); } };
    const first = resolveTraceSession({ get href() { return href; } }, history, () => "first-uuid");
    const reload = resolveTraceSession({ get href() { return href; } }, history, () => "unused-uuid");
    const second = beginNewTraceSession({ get href() { return href; } }, history, () => "second-uuid");
    expect(first).toEqual({ sessionId: "session-first-uuid", isNew: true });
    expect(reload).toEqual({ sessionId: "session-first-uuid", isNew: false });
    expect(second).toEqual({ sessionId: "session-second-uuid", isNew: true });
    expect(second.sessionId).not.toBe(first.sessionId);
  });
});
