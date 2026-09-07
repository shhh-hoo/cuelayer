import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// Check tracked paths, not a user's private ignored evidence archive.
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(path => path && existsSync(path));
const forbidden = files.filter(path =>
  path.startsWith(".cuelayer/") || path.startsWith("artifacts/") ||
  /^resources\/.*(?:\/results\/|(?:summary|playback-timing|integrity)[^/]*\.(?:json|jsonl)$)/.test(path) ||
  /^resources\/semantics\/(?!current\/|core\/(?:corpus\.jsonl|manifest\.json)$)/.test(path) ||
  /^(?:scripts|server\/teaching)\/(?:build-semantics-corpus|evaluate-semantics|semantic-evaluation)-v\d/.test(path));
if (forbidden.length) throw new Error(`Generated evidence or retired evaluators tracked:\n${forbidden.join("\n")}`);
const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;
if (Object.keys(scripts).some(key => /^eval:semantics:v\d|^eval:semantics:freeze/.test(key))) throw new Error("Retired corpus-build/version CLI exposed");
if (process.argv.includes("--clean") && execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) throw new Error("Checks produced repository changes; generated output must be ignored");
console.log("Repository hygiene: clean source/fixture/evidence boundary");
