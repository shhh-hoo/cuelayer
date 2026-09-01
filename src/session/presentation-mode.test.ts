import { describe, expect, it } from "vitest";
import { presentationModeFor } from "./presentation-mode";

describe("presentation mode selection", () => {
  it("uses the primary teaching surface when no presentation capture is live", () => {
    expect(presentationModeFor({ status: "empty", stream: null })).toBe("presentationless");
    expect(presentationModeFor({ status: "ended", stream: null })).toBe("presentationless");
  });

  it("preserves overlay rendering only for a live presentation capture", () => {
    expect(presentationModeFor({ status: "ready", stream: {} as MediaStream })).toBe("presentation-overlay");
    expect(presentationModeFor({ status: "ready", stream: null })).toBe("presentationless");
  });
});
