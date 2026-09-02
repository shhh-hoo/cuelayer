import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Vercel planner function boundary", () => {
  it("keeps implementation and tests outside the api function directory", async () => {
    const entries = (await readdir(resolve(process.cwd(), "api/planner"))).sort();
    expect(entries).toEqual(["decision.ts"]);
  });

  it("loads planner implementations from the server module boundary", async () => {
    const endpoint = await readFile(resolve(process.cwd(), "api/planner/decision.ts"), "utf8");
    const viteConfig = await readFile(resolve(process.cwd(), "vite.config.ts"), "utf8");
    expect(endpoint).toContain('from "../../server/planner/openai-planner.ts"');
    expect(endpoint).not.toContain('from "./openai-planner.ts"');
    expect(viteConfig).toContain('from "./server/planner/openai-planner.ts"');
    expect(viteConfig).not.toContain('from "./api/planner/');
  });

  it("forces Vercel to package the TypeScript runtime imported by the transpiled function", async () => {
    const config = JSON.parse(await readFile(resolve(process.cwd(), "vercel.json"), "utf8")) as {
      functions?: Record<string, { includeFiles?: string }>;
    };
    expect(config.functions?.["api/planner/decision.ts"]?.includeFiles).toBe("server/planner/**");
  });
});
