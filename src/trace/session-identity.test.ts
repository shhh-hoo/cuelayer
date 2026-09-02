import { describe, expect, it } from "vitest";
import { replaceTraceSessionId, resolveTraceSessionIdentity } from "./session-identity";

describe("trace session identity", () => {
  it("survives reload and can be replaced without dropping other URL parameters", () => {
    let href = "https://example.test/session?debug=speech";
    const location = { get href() { return href; } };
    const history = { replaceState(_data: unknown, _unused: string, url?: string | URL | null) { href = String(url); } };
    const first = resolveTraceSessionIdentity(location, history, () => "first-uuid");
    const reload = resolveTraceSessionIdentity(location, history, () => "unused-uuid");
    replaceTraceSessionId(location, history, "session-second-uuid");
    expect(first).toEqual({ sessionId: "session-first-uuid", created: true });
    expect(reload).toEqual({ sessionId: "session-first-uuid", created: false });
    expect(href).toContain("debug=speech");
    expect(href).toContain("sessionId=session-second-uuid");
  });
});
