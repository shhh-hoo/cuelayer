import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

function reachable(entries: string[], excluded: string[] = []) {
  const root = resolve(import.meta.dirname, "../../.."), seen = new Set<string>();
  function visit(path: string) {
    if (seen.has(path) || !/\.[cm]?tsx?$/.test(path)) return;
    seen.add(path);
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const imports: { name: string; dynamic: boolean }[] = [];
    function inspect(node: ts.Node) {
      // Type-only trace DTO references do not activate a semantic runtime.
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) imports.push({ name: node.moduleSpecifier.text, dynamic: false });
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push({ name: node.moduleSpecifier.text, dynamic: false });
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) imports.push({ name: node.arguments[0].text, dynamic: true });
      ts.forEachChild(node, inspect);
    }
    inspect(source);
    for (const { name, dynamic } of imports.filter(item => item.name.startsWith("."))) {
      const target = resolve(dirname(path), name);
      const file = [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`].find(existsSync);
      if (!file) throw Error(`Unresolved runtime import: ${path} -> ${name}`);
      if (dynamic && excluded.includes(file.slice(root.length + 1))) continue;
      visit(file);
    }
  }
  entries.forEach(entry => visit(resolve(root, entry)));
  return [...seen].map(path => path.slice(root.length + 1));
}

it("normal Core branch reaches only Core semantic authority and the accepted-content projector", () => {
  // These are the two literal, domain-gated lazy edges in the actual route/stage.
  const files = reachable(["src/main.tsx", "api/teaching/core-interpretation.ts"], ["src/session/LegacySession.tsx", "src/session/TeachingSurfaceLayer.tsx"]);
  expect(files).toContain("src/session/CoreSession.tsx");
  expect(files).toContain("src/lesson-stream/core/live-session.ts");
  expect(files).toContain("src/lesson-stream/core/runtime.ts");
  expect(files).toContain("src/session/CoreTeachingSurface.tsx");
  expect(files).toContain("src/representation-capabilities/accepted-text.tsx");
  expect(files.filter(path => /src\/dev\/|chemistry|math-capability|use-live-teaching|lesson-stream\/(runtime|teaching-state|accepted-interpretations)\.ts|server\/teaching\/openai-interpreter/.test(path))).toEqual([]);
  const legacy = reachable(["src/session/LegacySession.tsx"]);
  expect(legacy).toContain("src/lesson-stream/runtime.ts");
  expect(legacy).not.toContain("src/lesson-stream/core/runtime.ts");
});
it("makes the controlled Core controller/provider bridge reachable without introducing legacy semantic names in Core code", () => {
  const files = reachable(["src/lesson-stream/core/live-session.ts", "server/teaching/core/live-interpreter.ts"]);
  expect(files).toContain("src/lesson-stream/core/runtime.ts");
  expect(files).toContain("server/teaching/core/provider-contract.ts");
  for (const file of files.filter(path => path.startsWith("src/lesson-stream/core/") || path.startsWith("server/teaching/core/"))) {
    expect(readFileSync(resolve(import.meta.dirname, "../../..", file), "utf8")).not.toMatch(/\bBOARD_ITEM\b|targetBoardItemId|baseBoardRevision|\bSET_ACTIVE\b|board\.active_set|board\.context_retained/);
  }
});
