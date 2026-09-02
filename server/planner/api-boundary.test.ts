import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Vercel planner function boundary", () => {
  it("keeps implementation and tests outside the api function directory", async () => {
    const entries = (await readdir(resolve(process.cwd(), "api/planner"))).sort();
    expect(entries).toEqual(["decision.ts"]);
  });

  it("loads the planner implementation from the server module boundary", async () => {
    const source = await readFile(resolve(process.cwd(), "api/planner/decision.ts"), "utf8");
    expect(source).toContain('from "../../server/planner/openai-planner.ts"');
    expect(source).not.toContain('from "./openai-planner.ts"');
  });
});
