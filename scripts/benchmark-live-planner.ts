import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { requestDeepSeekPlannerResult } from "../server/planner/deepseek-planner.ts";
import { LIVE_PLANNER_GOLDENS, plannerInputForGolden } from "../server/planner/live-planner-golden.ts";
import { requestOpenAIPlannerResult } from "../server/planner/openai-planner.ts";
import type { PlannerProviderResult, PlannerProviderUsage } from "../server/planner/provider-contract.ts";
import { compileCaptionEpisode } from "../src/planner/caption-compiler.ts";
import type { RuntimeDecision } from "../src/planner/contracts.ts";
import { validateRuntimeDecision, type ValidationDegradation } from "../src/planner/validation.ts";

type CaseResult = {
  id: string;
  expected: string;
  rawProviderOutput?: RuntimeDecision;
  rawProviderIntent?: string;
  effectiveIntent?: string;
  structuredParseSuccess: boolean;
  runtimeValidationSuccess: boolean;
  runtimeValidationResult: { status: "accepted" } | { status: "degraded"; reason: ValidationDegradation } | { status: "rejected"; reason: string } | { status: "not-run"; reason: string };
  degradation?: ValidationDegradation;
  compileResult: { status: "success" | "failed" | "not-run"; reason?: string };
  compileSuccess?: boolean;
  expectedIntentMatch: boolean;
  providerRoundTripMs?: number;
  providerUsage?: PlannerProviderUsage;
  providerServiceTier?: string;
  error?: string;
};

type BenchmarkProvider = {
  name: "deepseek" | "openai";
  model: string;
  requestedServiceTier?: "default" | "priority";
  request(input: ReturnType<typeof plannerInputForGolden>): Promise<PlannerProviderResult>;
};

const OPENAI_LUNA_PRICING_PER_MILLION = { input: 0.20, cachedInput: 0.02, output: 1.20 } as const;

function percentile(values: number[], ratio: number) {
  if (!values.length) return undefined;
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1))];
}

function intentLabel(display: { kind: string; relation?: string }) { return display.kind === "RELATE" ? `RELATE/${display.relation}` : display.kind; }
function expectedLabel(item: typeof LIVE_PLANNER_GOLDENS[number]) { return item.expected.kind === "RELATE" ? `RELATE/${item.expected.relation}` : item.expected.kind; }
function rate(count: number, total: number) { return { count, total, rate: total ? count / total : null }; }
const relates = (intent: string | undefined) => intent?.startsWith("RELATE/") ?? false;

function benchmarkProvider(): BenchmarkProvider {
  const provider = process.argv.slice(2).find((arg) => arg.startsWith("--provider="))?.slice("--provider=".length) ?? "deepseek";
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is required to run the OpenAI planner benchmark.");
    const model = process.env.OPENAI_BENCHMARK_MODEL ?? "gpt-5.6-luna";
    const requestedServiceTier = process.argv.slice(2).find((arg) => arg.startsWith("--service-tier="))?.slice("--service-tier=".length);
    if (requestedServiceTier !== undefined && requestedServiceTier !== "default" && requestedServiceTier !== "priority") throw new Error("OpenAI --service-tier must be default or priority.");
    return { name: "openai", model, ...(requestedServiceTier ? { requestedServiceTier } : {}), request: (input) => requestOpenAIPlannerResult(input, apiKey, model, requestedServiceTier ? { serviceTier: requestedServiceTier } : undefined) };
  }
  if (provider !== "deepseek") throw new Error(`Unsupported benchmark provider: ${provider}`);
  const apiKey = process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY (or legacy OPENAI_API_KEY) is required to run the DeepSeek planner benchmark.");
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
  return { name: "deepseek", model, request: (input) => requestDeepSeekPlannerResult(input, apiKey, model) };
}

function totalUsage(results: CaseResult[]): PlannerProviderUsage | undefined {
  const usages = results.flatMap((item) => item.providerUsage ? [item.providerUsage] : []);
  if (!usages.length) return undefined;
  return usages.reduce((total, usage) => ({
    inputTokens: total.inputTokens + usage.inputTokens,
    cachedInputTokens: total.cachedInputTokens + usage.cachedInputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    totalTokens: total.totalTokens + usage.totalTokens,
  }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 });
}

function openAICostEstimate(usage: PlannerProviderUsage | undefined) {
  if (!usage) return undefined;
  const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const usd = (uncachedInput * OPENAI_LUNA_PRICING_PER_MILLION.input
    + usage.cachedInputTokens * OPENAI_LUNA_PRICING_PER_MILLION.cachedInput
    + usage.outputTokens * OPENAI_LUNA_PRICING_PER_MILLION.output) / 1_000_000;
  return { usd, pricingUsdPerMillionTokens: OPENAI_LUNA_PRICING_PER_MILLION };
}

function providerAuthenticationFailed(error: unknown) {
  return Boolean(error && typeof error === "object" && "status" in error && ((error as { status?: unknown }).status === 401 || (error as { status?: unknown }).status === 403));
}

async function main() {
  const provider = benchmarkProvider();
  const results: CaseResult[] = [];
  for (const item of LIVE_PLANNER_GOLDENS) {
    const input = plannerInputForGolden(item);
    const startedAt = performance.now();
    let raw: RuntimeDecision;
    let providerUsage: PlannerProviderUsage | undefined;
    let providerServiceTier: string | undefined;
    try {
      const providerResult = await provider.request(input);
      raw = providerResult.decision;
      providerUsage = providerResult.usage;
      providerServiceTier = providerResult.serviceTier;
    } catch (error) {
      if (providerAuthenticationFailed(error)) throw new Error(`${provider.name} benchmark authentication failed; its configured API key was rejected.`);
      const message = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 1000) : "planner request failed";
      results.push({ id: item.id, expected: expectedLabel(item), structuredParseSuccess: false, runtimeValidationSuccess: false, runtimeValidationResult: { status: "not-run", reason: "structured parse failed" }, compileResult: { status: "not-run", reason: "structured parse failed" }, expectedIntentMatch: false, providerRoundTripMs: Math.round(performance.now() - startedAt), error: message });
      continue;
    }
    const elapsed = Math.round(performance.now() - startedAt);
    try {
      const validation = validateRuntimeDecision(raw, input);
      const effective = validation.ok ? validation.decision : undefined;
      const rawProviderIntent = intentLabel(raw.display);
      const effectiveIntent = effective ? intentLabel(effective.display) : undefined;
      const nonQuiet = effective?.display.kind !== "QUIET";
      const compileSuccess = effective && nonQuiet ? Boolean(compileCaptionEpisode(input, effective, `benchmark:${item.id}`, 0)) : undefined;
      const runtimeValidationResult = validation.ok
        ? validation.degradation ? { status: "degraded" as const, reason: validation.degradation } : { status: "accepted" as const }
        : { status: "rejected" as const, reason: validation.error };
      const compileResult = effective && nonQuiet
        ? { status: compileSuccess ? "success" as const : "failed" as const }
        : { status: "not-run" as const, reason: effective ? "effective QUIET" : "runtime validation rejected" };
      results.push({
        id: item.id,
        expected: expectedLabel(item),
        rawProviderOutput: raw,
        rawProviderIntent,
        effectiveIntent,
        structuredParseSuccess: true,
        runtimeValidationSuccess: validation.ok && !validation.degradation,
        runtimeValidationResult,
        ...(validation.ok && validation.degradation ? { degradation: validation.degradation } : {}),
        compileResult,
        ...(compileSuccess === undefined ? {} : { compileSuccess }),
        expectedIntentMatch: effectiveIntent === expectedLabel(item),
        providerRoundTripMs: elapsed,
        ...(providerUsage ? { providerUsage } : {}),
        ...(providerServiceTier ? { providerServiceTier } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? `runtime: ${error.message.replace(/\s+/g, " ").slice(0, 990)}` : "runtime validation failed";
      results.push({ id: item.id, expected: expectedLabel(item), rawProviderOutput: raw, rawProviderIntent: intentLabel(raw.display), structuredParseSuccess: true, runtimeValidationSuccess: false, runtimeValidationResult: { status: "rejected", reason: message }, compileResult: { status: "not-run", reason: "runtime exception" }, expectedIntentMatch: false, providerRoundTripMs: elapsed, error: message });
    }
  }
  const providerLatencies = results.flatMap((item) => item.providerRoundTripMs === undefined ? [] : [item.providerRoundTripMs]).sort((a, b) => a - b);
  const quiet = results.filter((item) => item.effectiveIntent === "QUIET").length;
  const compiled = results.filter((item) => item.compileSuccess !== undefined);
  const expectedNonQuiet = results.filter((item) => item.expected !== "QUIET");
  const parsed = results.filter((item) => item.structuredParseSuccess);
  const degraded = results.filter((item) => item.degradation);
  const rawIntentMatches = results.filter((item) => item.rawProviderIntent === item.expected).length;
  const effectiveIntentMatches = results.filter((item) => item.effectiveIntent === item.expected).length;
  const degradationByRawIntent = Object.fromEntries([...new Set(parsed.flatMap((item) => item.rawProviderIntent ? [item.rawProviderIntent] : []))].sort().map((intent) => {
    const matching = parsed.filter((item) => item.rawProviderIntent === intent);
    return [intent, rate(matching.filter((item) => item.degradation).length, matching.length)];
  }));
  const rawRelate = results.filter((item) => relates(item.rawProviderIntent));
  const effectiveRelate = results.filter((item) => relates(item.effectiveIntent));
  const rawTransform = results.filter((item) => item.rawProviderIntent === "TRANSFORM");
  const effectiveTransform = results.filter((item) => item.effectiveIntent === "TRANSFORM");
  const usage = totalUsage(results);
  const report = {
    generatedAt: new Date().toISOString(), provider: provider.name, model: provider.model, corpusSize: results.length,
    ...(provider.requestedServiceTier ? { requestedServiceTier: provider.requestedServiceTier } : {}),
    structuredParseSuccess: `${results.filter((item) => item.structuredParseSuccess).length}/${results.length}`,
    runtimeValidationSuccess: `${results.filter((item) => item.runtimeValidationSuccess).length}/${results.length}`,
    rawIntentAccuracy: rate(rawIntentMatches, results.length),
    effectiveIntentAccuracy: rate(effectiveIntentMatches, results.length),
    runtimeInvalidRate: rate(parsed.filter((item) => !item.runtimeValidationSuccess).length, parsed.length),
    degradations: results.reduce<Record<string, number>>((counts, item) => { if (item.degradation) counts[item.degradation] = (counts[item.degradation] ?? 0) + 1; return counts; }, {}),
    degradationRate: rate(degraded.length, parsed.length),
    degradationRateByRawIntent: degradationByRawIntent,
    compileSuccessForNonQuiet: `${compiled.filter((item) => item.compileSuccess).length}/${compiled.length}`,
    compileSuccessRate: rate(compiled.filter((item) => item.compileSuccess).length, compiled.length),
    expectedNonQuietCompileSuccess: `${expectedNonQuiet.filter((item) => item.compileSuccess).length}/${expectedNonQuiet.length}`,
    expectedIntentMatch: `${results.filter((item) => item.expectedIntentMatch).length}/${results.length}`,
    falsePositiveRelateRate: {
      raw: rate(rawRelate.filter((item) => !relates(item.expected)).length, rawRelate.length),
      effective: rate(effectiveRelate.filter((item) => !relates(item.expected)).length, effectiveRelate.length),
    },
    falsePositiveTransformRate: {
      raw: rate(rawTransform.filter((item) => item.expected !== "TRANSFORM").length, rawTransform.length),
      effective: rate(effectiveTransform.filter((item) => item.expected !== "TRANSFORM").length, effectiveTransform.length),
    },
    quietRate: { raw: rate(results.filter((item) => item.rawProviderIntent === "QUIET").length, results.length), effective: rate(quiet, results.length) },
    providerRoundTripMs: {
      p50: percentile(providerLatencies, .5),
      p95: percentile(providerLatencies, .95),
      worst: providerLatencies.at(-1),
      within2_5Seconds: rate(providerLatencies.filter((value) => value <= 2_500).length, providerLatencies.length),
      within5Seconds: rate(providerLatencies.filter((value) => value <= 5_000).length, providerLatencies.length),
    },
    returnedServiceTiers: Object.fromEntries([...new Set(results.flatMap((item) => item.providerServiceTier ? [item.providerServiceTier] : []))].sort().map((tier) => [tier, results.filter((item) => item.providerServiceTier === tier).length])),
    ...(usage ? { providerUsage: usage } : {}),
    ...(provider.name === "openai" && provider.model === "gpt-5.6-luna" && usage ? { estimatedProviderCost: openAICostEstimate(usage) } : {}),
    browserTraceLatency: "not measured here; committed/final → planner completed and render activated require browser microphone traces",
    results,
  };
  const output = process.argv.slice(2).find((arg) => arg.startsWith("--output="))?.slice("--output=".length);
  if (output) {
    const path = resolve(process.cwd(), output);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
  const malformed = results.some((item) => !item.structuredParseSuccess);
  const accuracy = results.filter((item) => item.expectedIntentMatch).length / results.length;
  const runtimeFailure = results.some((item) => !item.runtimeValidationSuccess);
  const compileFailure = expectedNonQuiet.some((item) => item.compileSuccess !== true);
  const unsafeEffectiveStructure = results.some((item) => (relates(item.effectiveIntent) && !relates(item.expected)) || (item.effectiveIntent === "TRANSFORM" && item.expected !== "TRANSFORM"));
  if (malformed || accuracy < .95 || runtimeFailure || compileFailure || unsafeEffectiveStructure) process.exitCode = 1;
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
