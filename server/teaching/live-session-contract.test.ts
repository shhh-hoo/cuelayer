import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("normal /session LIVE-STATE contract", () => {
  it("uses Teaching State instead of the legacy caption planner and Space lock", async () => {
    const page = await readFile(resolve(process.cwd(), "src/session/SessionPage.tsx"), "utf8");
    expect(page).toContain("useLiveTeaching");
    expect(page).not.toContain("useTeachingPlanner");
    expect(page).not.toContain("toggle-caption-lock");
    expect(page).not.toContain('event.code !== "Space"');
  });

  it("mounts no canonical caption renderer on the normal learner stage", async () => {
    const stage = await readFile(resolve(process.cwd(), "src/session/PresentationStage.tsx"), "utf8");
    expect(stage).toContain("TeachingSurfaceLayer");
    expect(stage).not.toContain("SemanticCaptionLayer");
    expect(stage).not.toContain("canonical_speech_mounted");
  });
});
