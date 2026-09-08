import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

function reachable(entries: string[]) {
  const root = resolve(import.meta.dirname, "../../.."), seen = new Set<string>();
  function visit(path: string) {
    if (seen.has(path) || !/\.[cm]?tsx?$/.test(path)) return;
    seen.add(path);
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const imports: string[] = [];
    function inspect(node: ts.Node) {
      // Type-only trace DTO references do not activate a semantic runtime.
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
      ts.forEachChild(node, inspect);
    }
    inspect(source);
    for (const name of imports.filter(name => name.startsWith("."))) {
      const target = resolve(dirname(path), name);
      const file = [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`].find(existsSync);
      if (!file) throw Error(`Unresolved runtime import: ${path} -> ${name}`);
      visit(file);
    }
  }
  entries.forEach(entry => visit(resolve(root, entry)));
  return [...seen].map(path => path.slice(root.length + 1));
}

it("normal browser/API routes remain legacy and cannot activate the controlled Core pipeline", () => {
  const files = reachable(["src/main.tsx", "api/teaching/interpretation.ts", "vite.config.ts"]);
  expect(files).toContain("src/lesson-stream/runtime.ts");
  expect(files).toContain("server/teaching/provider-contract.ts");
  expect(files.some(path => path.startsWith("src/lesson-stream/core/") || path.startsWith("server/teaching/core/"))).toBe(false);
  expect(files).not.toContain("src/lesson-stream/open-runtime.ts");
});
it("makes the controlled Core controller/provider bridge reachable without introducing legacy semantic names in Core code", () => {
  const files = reachable(["src/lesson-stream/core/live-session.ts", "server/teaching/core/live-interpreter.ts"]);
  expect(files).toContain("src/lesson-stream/core/runtime.ts");
  expect(files).toContain("server/teaching/core/provider-contract.ts");
  for (const file of files.filter(path => path.startsWith("src/lesson-stream/core/") || path.startsWith("server/teaching/core/"))) {
    expect(readFileSync(resolve(import.meta.dirname, "../../..", file), "utf8")).not.toMatch(/\bBOARD_ITEM\b|targetBoardItemId|baseBoardRevision|\bSET_ACTIVE\b|board\.active_set|board\.context_retained/);
  }
});
