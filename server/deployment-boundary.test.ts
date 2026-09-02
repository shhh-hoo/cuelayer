import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(resolve(directory, entry.name)).map((file) => `${entry.name}/${file}`) : [entry.name]);
}

describe("Vercel deployment boundary", () => {
  it("keeps only the four HTTP entrypoints under api", () => {
    expect(files(resolve("api")).sort()).toEqual([
      "planner/decision.ts",
      "speechmatics/token.ts",
      "trace/events.ts",
      "trace/session.ts",
    ]);
  });

  it("does not duplicate Vercel endpoint behavior in Vite", () => {
    const config = readFileSync(resolve("vite.config.ts"), "utf8");
    expect(config).not.toContain("middlewares.use");
    expect(config).not.toContain("/api/");
  });

  it("includes the non-entrypoint server modules in each deployed Function bundle", () => {
    const config = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as { functions?: Record<string, { includeFiles?: string[] }> };
    expect(config.functions?.["api/**/*.ts"]?.includeFiles).toBe("{server/**,src/planner/contracts.ts,src/trace/durable-trace.ts}");
  });
});
