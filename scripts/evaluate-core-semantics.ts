import { readFileSync } from "node:fs";
import { evaluateCoreCase, loadCoreCorpus, validateCoreCorpus } from "../server/teaching/core/semantic-evaluation.ts";
import { interpretCore, openAICoreTransport } from "../server/teaching/core/openai-interpreter.ts";

const args = process.argv.slice(2);
const value = (name: string) => args[args.indexOf(name) + 1];
if (args.includes("--live")) {
  if (!args.includes("--model") || !value("--model") || !process.env.OPENAI_API_KEY) throw new Error("Explicit --model and OPENAI_API_KEY required for separately authorized model evaluation");
  const transport = openAICoreTransport(process.env.OPENAI_API_KEY), results = [];
  for (const item of loadCoreCorpus().cases) results.push(await evaluateCoreCase(item, async request => (await interpretCore(request, value("--model")!, transport)).proposal));
  console.log(JSON.stringify({ mode: "llm-semantic-evaluation", model: value("--model"), threshold: null, results }, null, 2));
  if (results.some(r => !r.pass)) process.exitCode = 1;
} else if (args.includes("--assess")) {
  const outputs = JSON.parse(readFileSync(value("--assess")!, "utf8")) as Record<string, unknown[]>;
  const results = [];
  for (const item of loadCoreCorpus().cases) results.push(await evaluateCoreCase(item, async (_request, id, turn) => outputs[id]?.[turn]));
  console.log(JSON.stringify({ mode: "saved-output-assessment", modelCalls: 0, results }, null, 2));
  if (results.some(r => !r.pass)) process.exitCode = 1;
} else {
  const result = await validateCoreCorpus();
  console.log(JSON.stringify(result, null, 2));
  if (result.passed !== result.cases) process.exitCode = 1;
}
