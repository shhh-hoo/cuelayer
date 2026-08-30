import { describe, expect, it } from "vitest";
import type { EffectPlan } from "../grammar/types";
import { planEndMs, resolveCaptionTimeline } from "./timing";

const focusPlan: EffectPlan = { operation: { kind: "FOCUS", targets: [{ tokenIds: ["t1"], exactText: "target" }] }, display: { treatmentId: "marker-sweep", intensity: "strong", startMs: 100, durationMs: 400, holdMs: 300, decay: "fade" } };

describe("EffectPlan timing", () => {
  it("keeps NONE as the default plain-caption behavior", () => {
    const none: EffectPlan = { operation: { kind: "NONE" }, display: { treatmentId: "plain", intensity: "subtle", startMs: 0, durationMs: 0, holdMs: 0, decay: "remain" } };
    expect(resolveCaptionTimeline(none, 1000, "fx", false)).toEqual({ phase: "plain", emphasis: 0, itemProgress: 0 });
  });

  it("consumes start, duration, hold and fade policy", () => {
    expect(resolveCaptionTimeline(focusPlan, 50, "fx", false).phase).toBe("plain");
    expect(resolveCaptionTimeline(focusPlan, 300, "fx", false).phase).toBe("trigger");
    expect(resolveCaptionTimeline(focusPlan, 600, "fx", false).phase).toBe("hold");
    expect(resolveCaptionTimeline(focusPlan, 900, "fx", false).phase).toBe("decay");
    expect(planEndMs(focusPlan)).toBe(1200);
  });

  it("uses an immediately readable static fallback for reduced motion", () => {
    expect(resolveCaptionTimeline(focusPlan, 0, "fx", true)).toEqual({ phase: "hold", emphasis: 1, itemProgress: 1 });
  });
});
