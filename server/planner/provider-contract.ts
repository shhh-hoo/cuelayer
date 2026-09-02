import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { PlannerInput, RuntimeDecision } from "../../src/planner/contracts.ts";
import { CUECAPTION_POLICY_SOURCE_FILES, CUECAPTION_POLICY_SOURCE_HASH, LIVE_CUECAPTION_POLICY } from "./generated/cuecaption-policy.ts";

const boundedText = z.string().min(1).max(600);
const groundedText = z.object({ segmentId: z.string().min(1).max(80), text: boundedText }).strict();
const warning = z.object({
  code: z.enum(["ASR_AMBIGUITY", "MISSING_STRUCTURE", "MISSING_REFERENCE", "MISSING_REACTION_FACT", "POSSIBLE_TEACHER_ERROR", "CONTEXT_CONFLICT"]),
  target: groundedText.nullable(),
}).strict();
const displayIntent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("QUIET"), reason: z.enum(["filler", "transition", "repetition", "unfinished", "insufficient-evidence"]) }).strict(),
  z.object({ kind: z.literal("TEXT") }).strict(),
  z.object({ kind: z.literal("FOCUS"), target: groundedText }).strict(),
  z.object({ kind: z.literal("RELATE"), relation: z.enum(["cause", "sequence", "contrast"]), targets: z.array(groundedText).min(2).max(6) }).strict(),
  z.object({ kind: z.literal("TRANSFORM"), from: groundedText, to: groundedText }).strict(),
]);
const learnerIntent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("NONE") }).strict(),
  z.object({ kind: z.literal("NOTE"), target: groundedText.nullable() }).strict(),
  z.object({ kind: z.literal("REFLECT"), target: groundedText.nullable() }).strict(),
]);

export const runtimeDecisionSchema = z.object({
  display: displayIntent,
  learner: learnerIntent,
  evidence: z.object({
    protected: z.array(groundedText).max(6).nullable(),
    rewrites: z.array(z.object({ source: groundedText, displayText: z.string().min(1).max(120) }).strict()).max(4).nullable(),
    warnings: z.array(warning).max(4).nullable(),
  }).strict().nullable(),
}).strict();

export const plannerPolicy = `You are CueLayer's one-call live Chemistry semantic planner. Return one compact current decision, not a dossier for every context segment. Every FOCUS, RELATE, TRANSFORM, learner, or evidence reference must be an exact non-empty Speechmatics substring with its segmentId. RELATE requires two or more distinct targets representing the relation's separate sides or steps; never repeat one target or use the full same sentence for every target. TEXT is exactly { kind: "TEXT" }: the runtime deterministically displays the current planner work span, so never copy, regenerate, normalize, or otherwise supply canonical text. Only include evidence when it is necessary to validate the selected decision. Do not generate canonical text, chemistry token lists, render hints, full segment records, or renderer details.

${LIVE_CUECAPTION_POLICY}

Authoritative CueCaption source hash: ${CUECAPTION_POLICY_SOURCE_HASH}
Authoritative CueCaption source files: ${CUECAPTION_POLICY_SOURCE_FILES.join(", ")}
`;

export type PlannerProviderUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type PlannerProviderResponse = {
  id?: string;
  model?: string;
  service_tier?: string;
  output_parsed: unknown;
  usage?: unknown;
};

export type PlannerProviderResult = { decision: RuntimeDecision; usage?: PlannerProviderUsage; serviceTier?: string; providerResponse: PlannerProviderResponse };

/** The one request object used both for the OpenAI SDK call and its factual trace. */
export function plannerResponseRequest(input: PlannerInput, model: string, options?: { serviceTier?: "default" | "priority" }) {
  return {
    model,
    reasoning: { effort: "none" as const },
    temperature: 0,
    max_output_tokens: 1_024,
    input: [{ role: "system" as const, content: plannerPolicy }, { role: "user" as const, content: JSON.stringify(input) }],
    text: { format: zodTextFormat(runtimeDecisionSchema, "runtime_decision") },
    ...(options?.serviceTier ? { service_tier: options.serviceTier } : {}),
  };
}

/** Trace only dynamic planner evidence; the static policy is reconstructible from its committed source hash. */
export function plannerTraceRequest(input: PlannerInput, request: ReturnType<typeof plannerResponseRequest>) {
  return {
    model: request.model,
    reasoning: request.reasoning,
    temperature: request.temperature,
    maxOutputTokens: request.max_output_tokens,
    policy: { sourceHash: CUECAPTION_POLICY_SOURCE_HASH, sourceFiles: CUECAPTION_POLICY_SOURCE_FILES },
    plannerInput: input,
  };
}

export function normalizeRuntimeDecision(parsed: z.infer<typeof runtimeDecisionSchema>): RuntimeDecision {
  const learner = parsed.learner.kind === "NONE" || parsed.learner.target
    ? parsed.learner
    : { kind: parsed.learner.kind };
  const parsedEvidence = parsed.evidence ?? null;
  const evidence = parsedEvidence === null ? {} : {
    ...(parsedEvidence.protected ? { protected: parsedEvidence.protected } : {}),
    ...(parsedEvidence.rewrites ? { rewrites: parsedEvidence.rewrites } : {}),
    ...(parsedEvidence.warnings ? { warnings: parsedEvidence.warnings.map(({ target, ...item }) => target ? { ...item, target } : item) } : {}),
  };
  return { display: parsed.display, learner, ...(Object.keys(evidence).length ? { evidence } : {}) } as RuntimeDecision;
}

export function normalizeProviderUsage(usage: unknown): PlannerProviderUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const value = usage as { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown; input_tokens_details?: { cached_tokens?: unknown } };
  if (typeof value.input_tokens !== "number" || typeof value.output_tokens !== "number") return undefined;
  return {
    inputTokens: value.input_tokens,
    cachedInputTokens: typeof value.input_tokens_details?.cached_tokens === "number" ? value.input_tokens_details.cached_tokens : 0,
    outputTokens: value.output_tokens,
    totalTokens: typeof value.total_tokens === "number" ? value.total_tokens : value.input_tokens + value.output_tokens,
  };
}
