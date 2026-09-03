import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("normal /session LIVE-STATE contract", () => {
  it("uses Teaching State for the learner surface", async () => {
    const page = await readFile(resolve(process.cwd(), "src/session/SessionPage.tsx"), "utf8");
    expect(page).toContain("useLiveTeaching");
  });

  it("mounts TeachingSurfaceLayer on the normal learner stage", async () => {
    const stage = await readFile(resolve(process.cwd(), "src/session/PresentationStage.tsx"), "utf8");
    expect(stage).toContain("TeachingSurfaceLayer");
  });
});
