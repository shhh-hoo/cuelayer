import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluateSemanticCasesV2,
  loadSemanticCorpusV2,
  SEMANTIC_PROFILES_V2,
  summarizeSemanticResultsV2,
  validateSemanticCorpusV2,
} from "../server/teaching/semantic-evaluation-v2.ts";

const args = process.argv.slice(2);
const valueAfter = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const validation = validateSemanticCorpusV2();

if (!validation.ok) {
  console.error(JSON.stringify(validation, null, 2));
  process.exitCode = 1;
} else if (args.includes("--validate") || !args.includes("--live")) {
  const bundle = loadSemanticCorpusV2();
  const outputDir = resolve("resources/semantics/v2/results");
  mkdirSync(outputDir, { recursive: true });
  const result = {
    ...validation,
    corpusVersion: bundle.manifest.corpusVersion,
    evaluatorVersion: bundle.manifest.evaluatorVersion,
    core: bundle.manifest.core,
    augment: bundle.manifest.augment,
  };
  writeFileSync(resolve(outputDir, "offline-validation.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(resolve(outputDir, "offline-validation.md"), `# SEMANTICS v2 offline validation\n\n- Corpus: ${bundle.manifest.corpusVersion}\n- Evaluator: ${bundle.manifest.evaluatorVersion}\n- Cases: ${validation.caseCount} (${validation.developmentCount} development / ${validation.holdoutCount} holdout)\n- Corpus SHA-256: ${validation.hash}\n- Core profile: ${bundle.manifest.core.profileVersion}\n- Candidate profile: ${bundle.manifest.augment.profileVersion}\n- Validation errors: ${validation.errors.length}\n`);
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
  const bundle = loadSemanticCorpusV2();
  const cases = bundle.cases.filter((item) => item.split === split);
  const profile = SEMANTIC_PROFILES_V2[profileName];
  const rates = {
    ...(process.env.OPENAI_INPUT_PER_MILLION ? { inputPerMillion: Number(process.env.OPENAI_INPUT_PER_MILLION) } : {}),
    ...(process.env.OPENAI_CACHED_INPUT_PER_MILLION ? { cachedInputPerMillion: Number(process.env.OPENAI_CACHED_INPUT_PER_MILLION) } : {}),
    ...(process.env.OPENAI_OUTPUT_PER_MILLION ? { outputPerMillion: Number(process.env.OPENAI_OUTPUT_PER_MILLION) } : {}),
  };
  const results = await evaluateSemanticCasesV2({ cases, profile, apiKey, model, pass, rates });
  const summary = summarizeSemanticResultsV2(results);
  const outputDir = resolve("resources/semantics/v2/results");
  mkdirSync(outputDir, { recursive: true });
  const stem = `${split}-${profileName}-pass-${pass}`;
  const artifact = {
    corpusVersion: bundle.manifest.corpusVersion,
    evaluatorVersion: bundle.manifest.evaluatorVersion,
    corpusHash: bundle.manifest.fileSha256,
    split, pass, profileId: profile.id, model, results, summary,
  };
  writeFileSync(resolve(outputDir, `${stem}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
  const failures = results.filter((item) => !item.accepted || item.mismatches.length || item.safetyViolations.length);
  writeFileSync(resolve(outputDir, `${stem}-failures.jsonl`), `${failures.map((item) => JSON.stringify(item)).join("\n")}\n`);
  writeFileSync(resolve(outputDir, `${stem}-failure-replays.jsonl`), `${failures.map((item) => JSON.stringify({ caseId: item.caseId, replayEvents: item.replayEvents, resultingState: item.resultingState, replayEqual: item.replayEqual, pendingCheckpointIds: item.pendingCheckpointIds, lostCheckpointIds: item.lostCheckpointIds })).join("\n")}\n`);
  const pct = (metric: { numerator: number; denominator: number }) => metric.denominator ? `${metric.numerator}/${metric.denominator} (${(100 * metric.numerator / metric.denominator).toFixed(1)}%)` : "0/0 (n/a)";
  const safetyRows = Object.entries(summary.criticalSafetyCounts).map(([gate, count]) => `| ${gate} | ${count} | ${results.filter((item) => item.safetyViolations.includes(gate)).map((item) => item.caseId).join(", ") || "—"} |`).join("\n");
  const markdown = `# SEMANTICS v2 ${split} ${profile.id} pass ${pass}\n\n- Model: ${model}\n- Corpus: ${bundle.manifest.corpusVersion} (${bundle.manifest.fileSha256})\n- Evaluator: ${bundle.manifest.evaluatorVersion}\n- Policy digest: ${summary.policyDigests.join(", ")}\n- Schema digest: ${summary.schemaDigests.join(", ")}\n- Structured parse: ${pct(summary.structuredParse)}\n- Accepted/conflict-handled: ${pct(summary.acceptedOrConflictHandled)}\n- Intervention decision: ${pct(summary.interventionDecision)}\n- Board transition: ${pct(summary.boardTransition)}\n- Cue lifecycle: ${pct(summary.cueLifecycle)}\n- Contribution mode: ${pct(summary.contributionMode)}\n- Semantic content: ${pct(summary.semanticContent)}\n- RECONSTRUCT: ${pct(summary.reconstruct)}\n- REPRESENT: ${pct(summary.represent)}\n- AUGMENT precision: ${pct(summary.augmentPrecision)}\n- Must-augment recall: ${pct(summary.mustAugmentRecall)}\n- Malformed/rejected: ${summary.malformedCount}/${summary.rejectedCount}\n- Tokens (input/cache/output): ${summary.totals.inputTokens}/${summary.totals.cachedInputTokens}/${summary.totals.outputTokens}\n- Latency: ${summary.totals.latencyMs} ms\n- Estimated cost: ${summary.totals.estimatedCostUsd ? `$${summary.totals.estimatedCostUsd.toFixed(6)}` : "rates not configured"}\n- Failed cases: ${summary.failedCaseIds.length ? summary.failedCaseIds.join(", ") : "none"}\n\n## Critical safety gates\n\n| Gate | Failures | Cases |\n|---|---:|---|\n${safetyRows}\n`;
  writeFileSync(resolve(outputDir, `${stem}.md`), markdown);
  console.log(markdown);
}
