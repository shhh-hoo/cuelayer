import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("keeps the Core library and dispatcher unreachable from production browser/API entry points", () => {
  const root = resolve(import.meta.dirname, "../../..");
  const seen = new Set<string>();
  function visit(path: string) {
    if (seen.has(path) || !/\.[cm]?tsx?$/.test(path)) return;
    seen.add(path);
    expect(path).not.toContain("/lesson-stream/core/");
    expect(path).not.toContain("/server/teaching/core/");
    expect(path).not.toContain("/lesson-stream/replay-versioned.");
    for (const { fileName } of ts.preProcessFile(readFileSync(path, "utf8"), true, true).importedFiles) {
      if (!fileName.startsWith(".")) continue;
      const target = resolve(dirname(path), fileName);
      const file = [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`].find(existsSync);
      if (!file) throw Error(`Unresolved local production import: ${path} -> ${fileName}`);
      visit(file);
    }
  }
  for (const entry of ["src/main.tsx", "api/teaching/interpretation.ts", "vite.config.ts"]) visit(resolve(root, entry));
  expect([...seen]).toContain(resolve(root, "src/lesson-stream/runtime.ts"));
  expect([...seen]).toContain(resolve(root, "server/teaching/provider-contract.ts"));
});
