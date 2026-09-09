import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createServer } from "vite";
import { m4bDevEntry } from "./entry.ts";

it("selects the separate harness entry only for its exact development URL", async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, plugins: [m4bDevEntry()] });
  try {
    const html = readFileSync(new URL("../../../index.html", import.meta.url), "utf8");
    const harness = await server.transformIndexHtml("/dev/m4b-canvas", html);
    const normal = await server.transformIndexHtml("/session", html);
    expect(harness).toContain('src="/src/dev/m4b-canvas/main.tsx"');
    expect(harness).not.toContain('src="/src/main.tsx"');
    expect(normal).toContain('src="/src/main.tsx"');
    expect(normal).not.toContain("m4b-canvas");
  } finally { await server.close(); }
});
it("disables the entry transform for production builds", () => {
  expect(m4bDevEntry().apply).toBe("serve");
});
