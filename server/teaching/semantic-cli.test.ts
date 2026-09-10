import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";

it("validates without credentials and writes only a fresh ignored run directory", () => {
  const corpus = "resources/semantics/current/corpus.jsonl";
  const hash = () => createHash("sha256").update(readFileSync(corpus)).digest("hex");
  const before = hash();
  const root = ".cuelayer/evals/semantics";
  const existing = new Set(existsSync(root) ? readdirSync(root) : []);
  const env = { ...process.env }; delete env.OPENAI_API_KEY;
  const output = execFileSync(process.execPath, ["--experimental-strip-types", "scripts/evaluate-semantics.ts", "--validate"], { encoding: "utf8", env });
  expect(JSON.parse(output).ok).toBe(true); expect(hash()).toBe(before);
  const created = readdirSync(root).filter(name => !existing.has(name));
  expect(created).toHaveLength(1);
  const latest = created[0]!;
  expect(JSON.parse(readFileSync(`${root}/${latest}/offline-validation.json`, "utf8")).hash).toBe(before);
  expect(execFileSync("git", ["check-ignore", `${root}/${latest}/offline-validation.json`], { encoding: "utf8" }).trim()).toBe(`${root}/${latest}/offline-validation.json`);
});
