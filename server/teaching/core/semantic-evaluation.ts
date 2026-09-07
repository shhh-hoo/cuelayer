import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { buildCoreInterpretationContext, CORE_CONTEXT_BUDGETS, type CoreInterpretationBinding } from "../../../src/lesson-stream/core/interpretation-context.ts";
import { acceptCoreInterpretation } from "../../../src/lesson-stream/core/interpretation-validation.ts";
import { CORE_EVENT_SCHEMA_VERSION } from "../../../src/lesson-stream/core/contracts.ts";
import { appendCoreEvent, createCoreReplay, replayCoreEvents, type CoreReplay } from "../../../src/lesson-stream/core/replay.ts";

export const CORE_CORPUS_VERSION = "core-interpretation-corpus-v1";
export const CORE_EVALUATOR_VERSION = "core-interpretation-evaluator-v1";
export const REQUIRED_CORE_SCENARIOS = ["same-core-growth", "definition-persistence", "branch-vs-new-core", "support-vs-core", "local-correction", "topic-shift", "false-topic-shift", "refocus", "no-duplicate-return", "multi-operation", "multi-step", "accepted-noop", "needs-context", "cue-independence", "projected-only", "partial-not-absence", "bounded-long-lesson", "faithful-teacher-claim", "no-autonomous-correction", "no-arbitrary-cue", "domain-provenance"];
const text = z.string().min(1);
const selector = z.object({ kind: z.enum(["CORE", "OBJECT", "RELATION", "SUPPORT", "CUE"]), contains: text.nullable() }).strict();
const predicate = z.object({ location: z.enum(["OBJECT", "RELATION", "SUPPORT"]), all: z.array(z.array(text).min(1)).min(1), none: z.array(text), status: z.enum(["valid", "invalidated", "superseded"]) }).strict();
const gold = z.object({
  outcome: z.enum(["PROPOSE", "NEEDS_CONTEXT"]), cores: z.number().int().nonnegative(),
  currentContains: text.nullable(), cueKind: z.enum(["NOTE", "QUESTION", "TASK", "HINT"]).nullable(),
  facts: z.array(predicate), forbidden: z.array(text),
  minSteps: z.number().int().nonnegative(), minOperations: z.number().int().nonnegative(),
  sameCurrent: z.boolean(), domainFacts: z.number().int().nonnegative(),
  prefixForbidden: z.array(z.object({ throughStep: z.number().int().nonnegative(), text }).strict()).default([]),
}).strict();
export const coreCorpusCaseSchema = z.object({
  id: text, split: z.enum(["development", "holdout"]), tags: z.array(text).min(1), rationale: text,
  turns: z.array(z.object({
    speech: z.array(text).min(1), references: z.record(text, selector), exemplar: z.unknown(), expected: gold,
    domainRules: z.array(z.object({ id: text, text, basis: text }).strict()),
    partial: z.boolean(),
  }).strict()).min(1),
}).strict();
export type CoreCorpusCase = z.infer<typeof coreCorpusCaseSchema>;
const timestamp = "2026-09-07T00:00:00.000Z";
const lower = (s: string) => s.normalize("NFKC").toLowerCase();

function commit(replay: CoreReplay, speech: string) {
  const sequence = replay.events.length + 1, lessonSequence = replay.checkpoints.length + 1, checkpointId = `checkpoint-${lessonSequence}`;
  return appendCoreEvent(replay, { schemaVersion: CORE_EVENT_SCHEMA_VERSION, eventId: `event-${sequence}`, sessionId: replay.state.sessionId, sequence, type: "evidence.checkpoint_committed", timestamp,
    checkpoint: { checkpointId, lessonSequence, speechRunId: "corpus", startMs: lessonSequence, endMs: lessonSequence + 1, text: speech, sourceFinalIds: [], warnings: [] },
    grounding: { checkpointId, canonicalSpanIds: [{ spanId: `span-${lessonSequence}`, spanRevision: 1 }], words: [], providerEvidence: [] } });
}

/** Exemplar selectors belong to corpus authoring only. They are never sent to a provider. */
export function materializeCoreExemplar(turn: CoreCorpusCase["turns"][number], request: CoreInterpretationBinding): unknown {
  const handles = new Map<string, string>();
  for (const [name, selector] of Object.entries(turn.references)) {
    const matches = request.context.entities.filter(entity => {
      if (entity.kind !== selector.kind) return false;
      if (selector.contains === null) return entity.kind === "CORE" ? request.context.knowledge.current === entity.handle : true;
      if (entity.kind !== "CORE") return entity.text?.includes(selector.contains);
      return request.context.entities.some(child => child.core === entity.handle && child.text?.includes(selector.contains!));
    });
    if (matches.length !== 1) throw new Error(`core-corpus-selector-ambiguous:${name}`);
    handles.set(name, matches[0]!.handle);
  }
  const walk = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(walk);
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(Object.entries(input).map(([key, value]) => {
      if (key === "existing") {
        const handle = handles.get(String(value));
        if (!handle) throw new Error(`core-corpus-selector-missing:${value}`);
        return [key, handle];
      }
      return [key, walk(value)];
    }));
  };
  return walk(turn.exemplar);
}

export function assessCoreTurn(expected: CoreCorpusCase["turns"][number]["expected"], result: ReturnType<typeof acceptCoreInterpretation>, before: CoreReplay) {
  const failures: string[] = [], state = result.replay.state, cores = Object.values(state.knowledge.cores);
  const units = cores.flatMap(c => (["OBJECT", "RELATION", "SUPPORT"] as const).flatMap(kind => Object.values(c[kind === "OBJECT" ? "objects" : kind === "RELATION" ? "relations" : "supports"]).map(unit => ({ kind, unit }))));
  if (result.kind !== expected.outcome) failures.push("outcome");
  if (cores.length !== expected.cores) failures.push("core-count");
  if ((state.cue.active?.kind ?? null) !== expected.cueKind) failures.push("cue-lifecycle");
  const current = state.knowledge.currentCoreId && state.knowledge.cores[state.knowledge.currentCoreId];
  if (expected.currentContains && (!current || !Object.values(current.objects).some(o => lower(o.value.text).includes(lower(expected.currentContains!))))) failures.push("current-core");
  if (expected.sameCurrent && state.knowledge.currentCoreId !== before.state.knowledge.currentCoreId) failures.push("core-identity-changed");
  for (const [index, fact] of expected.facts.entries()) if (!units.some(({ kind, unit }) => kind === fact.location && unit.status === fact.status && fact.all.every(aliases => aliases.some(t => lower(unit.value.text).includes(lower(t)))) && fact.none.every(t => !lower(unit.value.text).includes(lower(t))))) failures.push(`fact:${index}`);
  const validText = units.filter(u => u.unit.status === "valid").map(u => u.unit.value.text).concat(state.cue.active?.text ?? "").join("\n");
  for (const forbidden of expected.forbidden) if (lower(validText).includes(lower(forbidden))) failures.push(`forbidden:${forbidden}`);
  if (result.steps.length < expected.minSteps) failures.push("step-count");
  if (result.steps.reduce((sum, step) => sum + step.knowledgeOps.length, 0) < expected.minOperations) failures.push("operation-count");
  if (units.filter(u => u.unit.value.provenance.domainBasis !== undefined).length !== expected.domainFacts) failures.push("domain-provenance");
  for (const forbidden of expected.prefixForbidden) {
    const prefix = result.steps.slice(0, forbidden.throughStep + 1).flatMap(step => [...step.knowledgeOps.flatMap(op => "value" in op ? [op.value.text] : []), ...("value" in step.cueDelta ? [step.cueDelta.value.text] : [])]).join("\n");
    if (lower(prefix).includes(lower(forbidden.text))) failures.push(`premature-content:${forbidden.text}`);
  }
  if (result.kind === "NEEDS_CONTEXT" && (result.events.length || JSON.stringify(result.replay) !== JSON.stringify(before))) failures.push("needs-context-mutated-state");
  if (JSON.stringify(replayCoreEvents(result.replay.events).state) !== JSON.stringify(state)) failures.push("replay-mismatch");
  return failures;
}

export type CoreEvaluationProvider = (request: CoreInterpretationBinding, caseId: string, turnIndex: number) => Promise<unknown>;
/** Same Core path for saved outputs, injected model adapters, and reviewed exemplars. No legacy runtime. */
export async function evaluateCoreCase(input: unknown, provider?: CoreEvaluationProvider) {
  const item = coreCorpusCaseSchema.parse(input);
  let replay = appendCoreEvent(createCoreReplay(item.id), { schemaVersion: CORE_EVENT_SCHEMA_VERSION, sessionId: item.id, eventId: "start", sequence: 1, type: "lesson.started", timestamp });
  const results: Array<{ turn: number; failures: string[]; contextCharacters: number; proposal?: unknown }> = [];
  for (const [index, turn] of item.turns.entries()) {
    for (const speech of turn.speech) replay = commit(replay, speech);
    const before = replay;
    let contextCharacters = 0;
    try {
      const request = buildCoreInterpretationContext(replay, { requestId: `${item.id}-${index}`, newEvidence: replay.checkpoints.filter(c => c.lessonSequence > replay.state.processedThroughSequence), domainRules: turn.domainRules,
        ...(turn.partial ? { includeCue: false, budgets: { optionalRoots: 0, candidateCores: 0 } } : {}) });
      contextCharacters = JSON.stringify(request.context).length;
      const proposal = provider ? await provider(request, item.id, index) : materializeCoreExemplar(turn, request);
      const result = acceptCoreInterpretation(request, proposal, timestamp);
      const failures = assessCoreTurn(turn.expected, result, before);
      if (contextCharacters > CORE_CONTEXT_BUDGETS.maxCharacters) failures.push("context-budget");
      results.push({ turn: index, failures, contextCharacters, proposal }); replay = result.replay;
      if (failures.length) break;
    } catch (error) {
      results.push({ turn: index, failures: [error instanceof Error ? error.message : String(error)], contextCharacters }); break;
    }
  }
  return { id: item.id, split: item.split, results, pass: results.length === item.turns.length && results.every(r => !r.failures.length), evaluationMode: provider ? "provider-output" : "exemplar-contract" };
}

export function loadCoreCorpus(directory = new URL("../../../resources/semantics/core/", import.meta.url)) {
  const content = readFileSync(new URL("corpus.jsonl", directory), "utf8"), manifest = JSON.parse(readFileSync(new URL("manifest.json", directory), "utf8"));
  const cases = content.trim().split("\n").map(line => coreCorpusCaseSchema.parse(JSON.parse(line)));
  const hash = createHash("sha256").update(content).digest("hex");
  if (manifest.corpus !== CORE_CORPUS_VERSION || manifest.evaluator !== CORE_EVALUATOR_VERSION || manifest.sha256 !== hash || manifest.cases !== cases.length) throw new Error("core-corpus-manifest-mismatch");
  if (new Set(cases.map(c => c.id)).size !== cases.length) throw new Error("core-corpus-duplicate-case");
  for (const split of ["development", "holdout"]) {
    const count = cases.filter(c => c.split === split).length;
    if (!count || manifest.splitCounts?.[split] !== count) throw new Error("core-corpus-split-mismatch");
  }
  for (const scenario of REQUIRED_CORE_SCENARIOS) if (!cases.some(c => c.tags.includes(scenario))) throw new Error(`core-corpus-coverage-missing:${scenario}`);
  return { cases, manifest, hash };
}
export async function validateCoreCorpus() {
  const bundle = loadCoreCorpus(), results = [];
  for (const item of bundle.cases) results.push(await evaluateCoreCase(item));
  return { corpus: CORE_CORPUS_VERSION, evaluator: CORE_EVALUATOR_VERSION, hash: bundle.hash, cases: results.length, passed: results.filter(r => r.pass).length,
    modelCalls: 0, mode: "exemplar-contract", failures: results.filter(r => !r.pass) };
}
