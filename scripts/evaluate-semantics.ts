import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateSemanticCases, loadSemanticCorpus, SEMANTIC_PROFILES, summarizeSemanticResults, validateSemanticCorpus } from "../server/teaching/semantic-evaluation.ts";

const args = process.argv.slice(2);
const valueAfter = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const validation = validateSemanticCorpus();
if (!validation.ok) {
  console.error(JSON.stringify(validation, null, 2));
  process.exitCode = 1;
} else if (args.includes("--validate") || !args.includes("--live")) {
  const bundle = loadSemanticCorpus();
  const outputDir = resolve("resources/semantics/results");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "offline-validation.json"), `${JSON.stringify({ ...validation, corpusVersion: bundle.manifest.corpusVersion, policyVersion: bundle.manifest.policyVersion, profileVersion: bundle.manifest.profileVersion, policyDigest: bundle.manifest.policyDigest, schemaDigest: bundle.manifest.schemaDigest }, null, 2)}\n`);
  writeFileSync(resolve(outputDir, "offline-validation.md"), `# SEMANTICS offline validation\n\n- Corpus: ${bundle.manifest.corpusVersion}\n- Cases: ${validation.caseCount} (${validation.developmentCount} development / ${validation.holdoutCount} holdout)\n- Corpus SHA-256: ${validation.hash}\n- Policy: ${bundle.manifest.policyVersion}\n- Profile: ${bundle.manifest.profileVersion}\n- Policy digest: ${bundle.manifest.policyDigest}\n- Schema digest: ${bundle.manifest.schemaDigest}\n- Validation errors: ${validation.errors.length}\n`);
  console.log(JSON.stringify(validation, null, 2));
} else {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for live semantic evaluation");
  const split = valueAfter("--split") ?? "development";
  if (split !== "development" && split !== "holdout") throw new Error("--split must be development or holdout");
  const profileName = valueAfter("--profile") ?? "core";
  if (profileName !== "core" && profileName !== "augment") throw new Error("--profile must be core or augment");
  const pass = Number(valueAfter("--pass") ?? "1");
  if (!Number.isInteger(pass) || pass < 1) throw new Error("--pass must be a positive integer");
  const model = process.env.OPENAI_TEACHING_MODEL ?? "gpt-5.6-luna";
  const bundle = loadSemanticCorpus();
  const cases = bundle.cases.filter((item) => item.split === split);
  const rates = {
    ...(process.env.OPENAI_INPUT_PER_MILLION ? { inputPerMillion: Number(process.env.OPENAI_INPUT_PER_MILLION) } : {}),
    ...(process.env.OPENAI_CACHED_INPUT_PER_MILLION ? { cachedInputPerMillion: Number(process.env.OPENAI_CACHED_INPUT_PER_MILLION) } : {}),
    ...(process.env.OPENAI_OUTPUT_PER_MILLION ? { outputPerMillion: Number(process.env.OPENAI_OUTPUT_PER_MILLION) } : {}),
  };
  const profile = SEMANTIC_PROFILES[profileName];
  const results = await evaluateSemanticCases({ cases, profile, apiKey, model, pass, rates });
  const summary = summarizeSemanticResults(results);
  const outputDir = resolve("resources/semantics/results");
  mkdirSync(outputDir, { recursive: true });
  const stem = `${split}-${profileName}-pass-${pass}`;
  writeFileSync(resolve(outputDir, `${stem}.json`), `${JSON.stringify({ corpusVersion: bundle.manifest.corpusVersion, corpusHash: bundle.manifest.fileSha256, split, pass, profileId: profile.id, model, results, summary }, null, 2)}\n`);
  writeFileSync(resolve(outputDir, `${stem}-failures.jsonl`), `${results.filter((item) => !item.accepted || item.mismatches.length || item.safetyViolations.length).map((item) => JSON.stringify(item)).join("\n")}\n`);
  const pct = (metric: { numerator: number; denominator: number }) => metric.denominator ? `${metric.numerator}/${metric.denominator} (${(100 * metric.numerator / metric.denominator).toFixed(1)}%)` : "0/0 (n/a)";
  const markdown = `# SEMANTICS ${split} ${profile.id} pass ${pass}\n\n- Model: ${model}\n- Corpus: ${bundle.manifest.corpusVersion} (${bundle.manifest.fileSha256})\n- Structured parse: ${pct(summary.structuredParse)}\n- Accepted/conflict-handled: ${pct(summary.acceptedOrConflictHandled)}\n- Intervention decision: ${pct(summary.interventionDecision)}\n- Board transition: ${pct(summary.boardTransition)}\n- Cue lifecycle: ${pct(summary.cueLifecycle)}\n- Contribution mode: ${pct(summary.contributionMode)}\n- RECONSTRUCT: ${pct(summary.reconstruct)}\n- REPRESENT: ${pct(summary.represent)}\n- AUGMENT precision: ${pct(summary.augmentPrecision)}\n- Must-augment recall: ${pct(summary.mustAugmentRecall)}\n- Safety counts: ${JSON.stringify(summary.criticalSafetyCounts)}\n- Tokens (input/cache/output): ${summary.totals.inputTokens}/${summary.totals.cachedInputTokens}/${summary.totals.outputTokens}\n- Latency: ${summary.totals.latencyMs} ms\n- Estimated cost: ${summary.totals.estimatedCostUsd ? `$${summary.totals.estimatedCostUsd.toFixed(6)}` : "rates not configured"}\n- Failed cases: ${summary.failedCaseIds.length ? summary.failedCaseIds.join(", ") : "none"}\n`;
  writeFileSync(resolve(outputDir, `${stem}.md`), markdown);
  console.log(markdown);
}
