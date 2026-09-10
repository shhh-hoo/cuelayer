import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { coreProviderIdentity } from "../server/teaching/core/provider-contract.ts";
import { CORE_CONTEXT_VERSION } from "../src/lesson-stream/core/interpretation-context.ts";
import { evaluateCoreCase, loadCoreCorpus, validateCoreCorpus } from "../server/teaching/core/semantic-evaluation.ts";
import { interpretCore, openAICoreTransport } from "../server/teaching/core/openai-interpreter.ts";

const args = process.argv.slice(2);
const dataset = args.includes("--fresh-holdout") ? "fresh-holdout" : "baseline";
const value = (name: string) => args[args.indexOf(name) + 1];
if (args.includes("--live")) {
  if (!args.includes("--model") || !value("--model") || !process.env.OPENAI_API_KEY) throw new Error("Explicit --model and OPENAI_API_KEY required for separately authorized model evaluation");
  const diagnosticsPath = `.cuelayer/evaluations/core-calls-${new Date().toISOString().replaceAll(":", "-")}-${process.pid}.jsonl`;
  mkdirSync(dirname(diagnosticsPath), { recursive: true });
  writeFileSync(diagnosticsPath, "", { flag: "wx" });
  const bundle = loadCoreCorpus(undefined, dataset);
  const transport = openAICoreTransport(process.env.OPENAI_API_KEY), results = [];
  for (const item of bundle.cases) results.push(await evaluateCoreCase(item, async (request, caseId, turn, record) => (await interpretCore(request, value("--model")!, transport, undefined, diagnostic => {
    appendFileSync(diagnosticsPath, JSON.stringify({ caseId, turn, dataset, corpusHash: bundle.hash, identity: coreProviderIdentity, context: CORE_CONTEXT_VERSION, ...diagnostic }) + "\n");
    record(diagnostic);
  })).proposal));
  console.log(JSON.stringify({ mode: "llm-semantic-evaluation", model: value("--model"), threshold: null, dataset, corpusHash: bundle.hash, identity: coreProviderIdentity, context: CORE_CONTEXT_VERSION, diagnosticsPath, results }, null, 2));
  if (results.some(r => !r.pass)) process.exitCode = 1;
} else if (args.includes("--assess")) {
  const outputs = JSON.parse(readFileSync(value("--assess")!, "utf8")) as Record<string, unknown[]>;
  const results = [];
  for (const item of loadCoreCorpus(undefined, dataset).cases) results.push(await evaluateCoreCase(item, async (_request, id, turn) => outputs[id]?.[turn]));
  console.log(JSON.stringify({ mode: "saved-output-assessment", modelCalls: 0, results }, null, 2));
  if (results.some(r => !r.pass)) process.exitCode = 1;
} else {
  const result = await validateCoreCorpus(dataset);
  console.log(JSON.stringify(result, null, 2));
  if (result.passed !== result.cases) process.exitCode = 1;
}
