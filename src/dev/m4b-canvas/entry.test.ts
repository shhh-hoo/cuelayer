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
    // Vite's SPA fallback rewrites req.url before the HTML middleware runs.
    // The requested route survives only in originalUrl.
    for (const originalUrl of ["/dev/m4b-canvas", "/dev/m4b-canvas?review=1"]) {
      const fallback = await server.transformIndexHtml("/index.html", html, originalUrl);
      expect(fallback).toContain('src="/src/dev/m4b-canvas/main.tsx"');
      expect(fallback).not.toContain('src="/src/main.tsx"');
    }
    const sessionFallback = await server.transformIndexHtml("/index.html", html, "/session");
    expect(sessionFallback).toContain('src="/src/main.tsx"');
    expect(sessionFallback).not.toContain("m4b-canvas");
  } finally { await server.close(); }
});
it("disables the entry transform for production builds", () => {
  expect(m4bDevEntry().apply).toBe("serve");
});
