import type { CompactEvidenceCheckpoint } from "../contracts.ts";
import type { CoreTeachingState, Provenance, SemanticReference } from "./contracts.ts";
import { appendCoreEvent, createCoreReplay, type CoreReplay } from "./replay.ts";
import { resolveSemanticReference } from "./teaching-state.ts";

export const CORE_CONTEXT_VERSION = "core-interpretation-context-v1";
export const CORE_CONTEXT_BUDGETS = Object.freeze({ maxCharacters: 32_000, maxEntities: 48, candidateCores: 3, optionalRoots: 18, recentEvidence: 6, recentChanges: 4, unresolved: 8, priors: 4, domainRules: 8 });
export type Capability = "reference" | "append" | "refocus" | "revise" | "invalidate" | "supersede";
export type DomainRule = { id: string; text: string; basis: string };
export type BoundEntity = { target: SemanticReference; capabilities: Capability[] };
type ProjectedEntity = { handle: string; kind: SemanticReference["kind"]; core?: string; status: string; capabilities: Capability[]; text?: string; from?: string; to?: string; target?: string; cueKind?: string; origins: string[]; contents?: "complete" | "partial" };
export type InterpretationContext = {
  version: typeof CORE_CONTEXT_VERSION;
  evidence: Array<{ handle: string; sequence: number; text: string; warnings: string[]; consumption: "new" | "history" }>;
  entities: ProjectedEntity[];
  knowledge: { empty: boolean; cores: "complete" | "partial"; current: string | null };
  cue: { presence: "absent" | "included" | "omitted"; active: string | null };
  candidates: string[];
  recentChanges: Array<{ changes: Array<{ action: string; target: string; replacement?: string }>; complete: boolean; consumedSequences: number[] }>;
  unresolved: Array<{ evidence: string; phrase: string }>;
  structuralPriors: string[];
  domainRules: DomainRule[];
  history: "partial";
};
export type CoreInterpretationBinding = {
  requestId: string; base: CoreReplay; context: InterpretationContext;
  entities: ReadonlyMap<string, BoundEntity>;
  evidence: ReadonlyMap<string, CompactEvidenceCheckpoint>;
  newEvidenceIds: string[]; domainRules: readonly DomainRule[];
};
const key = (ref: SemanticReference) => JSON.stringify([ref.kind, "coreId" in ref ? ref.coreId : null, ref.id]);
const characters = (value: unknown) => JSON.stringify(value).length;
const valid = (value: ReturnType<typeof resolveSemanticReference>) => value && (!("status" in value) || value.status === "valid");

/** Reconstructs exact channel snapshots. Historical provenance never reads today's same-ID value. */
export function historicalSources(base: CoreReplay) {
  const knowledge = new Map<number, CoreTeachingState>(), cue = new Map<number, CoreTeachingState>();
  let replay = createCoreReplay(base.state.sessionId);
  knowledge.set(0, replay.state); cue.set(0, replay.state);
  for (const event of base.events) {
    replay = appendCoreEvent(replay, event);
    knowledge.set(replay.state.knowledge.revision, replay.state);
    cue.set(replay.state.cue.revision, replay.state);
  }
  const resolve = (target: SemanticReference, revision: number) => {
    const snapshot = (target.kind === "CUE" ? cue : knowledge).get(revision);
    const value = snapshot && resolveSemanticReference(snapshot, target);
    if (!valid(value)) throw new Error("core-context-historical-reference-invalid");
    return value!;
  };
  const seen = new Set<string>(), memo = new Map<string, string[]>();
  const origins = (p: Provenance): string[] => {
    const result = new Set<string>();
    for (const ref of p.speechRefs) {
      if (!base.checkpoints.find(c => c.checkpointId === ref.checkpointId)?.text.includes(ref.quote) || !ref.quote.trim()) throw new Error("core-context-source-evidence-missing");
      result.add("speech");
    }
    if (p.domainBasis !== undefined) result.add("domain");
    for (const ref of p.stateRefs) {
      const source = resolve(ref.target, ref.revision);
      result.add("accepted_state");
      const sourceKey = JSON.stringify(ref);
      const cached = memo.get(sourceKey);
      if (cached) { cached.forEach(origin => result.add(origin)); continue; }
      if (seen.has(sourceKey)) throw new Error("core-context-provenance-cycle");
      seen.add(sourceKey);
      const upstream = origins("value" in source ? source.value.provenance : source.provenance);
      memo.set(sourceKey, upstream);
      for (const origin of upstream) result.add(origin);
      seen.delete(sourceKey);
    }
    if (!result.size) throw new Error("core-context-provenance-missing");
    return [...result].sort();
  };
  return { resolve, origins };
}

export type ContextOptions = {
  requestId: string; newEvidence: readonly CompactEvidenceCheckpoint[];
  required?: readonly SemanticReference[];
  readOnly?: readonly SemanticReference[];
  /** Explicit host authorization; dependencies remain reference-only. */
  writable?: readonly SemanticReference[];
  includeCue?: boolean;
  unresolved?: readonly { checkpointId: string; phrase: string }[];
  structuralPriors?: readonly string[];
  domainRules?: readonly DomainRule[];
  budgets?: Partial<Record<keyof typeof CORE_CONTEXT_BUDGETS, number>>;
};

/** Pure projection. All indexes and archival lineage remain local; no durable state is trimmed. */
export function buildCoreInterpretationContext(input: CoreReplay, options: ContextOptions): CoreInterpretationBinding {
  const base = structuredClone(input), budgets = { ...CORE_CONTEXT_BUDGETS, ...options.budgets };
  for (const value of Object.values(budgets)) if (!Number.isSafeInteger(value) || value < 0) throw new Error("core-context-budget-invalid");
  const pending = base.checkpoints.filter(c => c.lessonSequence > base.state.processedThroughSequence);
  if (!options.requestId || !options.newEvidence.length || options.newEvidence.some((c, i) => JSON.stringify(c) !== JSON.stringify(pending[i]))) throw new Error("core-context-pending-prefix-invalid");
  const selected = new Map<string, BoundEntity>(), evidence = new Map<string, CompactEvidenceCheckpoint>();
  const sources = historicalSources(base), readOnly = new Set((options.readOnly ?? []).map(key));
  const writable = new Set((options.writable ?? []).map(key));
  const rules = structuredClone([...(options.domainRules ?? [])]);
  if (rules.length > budgets.domainRules || new Set(rules.map(r => r.id)).size !== rules.length || rules.some(r => !/^[a-z][a-z0-9_]{0,39}$/.test(r.id) || !r.text.trim() || !r.basis.trim())) throw new Error("core-context-domain-rules-invalid");
  const context: InterpretationContext = {
    version: CORE_CONTEXT_VERSION, evidence: [], entities: [],
    knowledge: { empty: Object.keys(base.state.knowledge.cores).length === 0, cores: "partial", current: null },
    cue: { presence: base.state.cue.active ? "omitted" : "absent", active: null }, candidates: [], recentChanges: [], unresolved: [],
    structuralPriors: [], domainRules: rules, history: "partial",
  };
  const fits = () => context.entities.length <= budgets.maxEntities && characters(context) <= budgets.maxCharacters;
  const addEvidence = (checkpoint: CompactEvidenceCheckpoint, consumption: "new" | "history") => {
    const existing = [...evidence].find(([, c]) => c.checkpointId === checkpoint.checkpointId);
    if (existing) return existing[0];
    const handle = `e${evidence.size}`;
    evidence.set(handle, checkpoint);
    context.evidence.push({ handle, sequence: checkpoint.lessonSequence, text: checkpoint.text, warnings: checkpoint.warnings.map(w => w.code), consumption });
    return handle;
  };
  options.newEvidence.forEach(c => addEvidence(structuredClone(c), "new"));
  const handleFor = (target: SemanticReference) => [...selected].find(([, e]) => key(e.target) === key(target))?.[0];
  const add = (target: SemanticReference): string => {
    const prior = handleFor(target); if (prior) return prior;
    const value = resolveSemanticReference(base.state, target);
    if (!value) throw new Error("core-context-required-reference-missing");
    const handle = `r${selected.size}`;
    const authorized = writable.has(key(target)) || (target.kind === "CORE" && target.id === base.state.knowledge.currentCoreId);
    const capabilities: Capability[] = !valid(value) ? [] : !authorized ? ["reference"] : target.kind === "CORE" ? ["reference", "append", "refocus"]
      : target.kind === "CUE" ? ["reference", "revise"] : ["reference", "revise", "invalidate", "supersede"];
    const granted = readOnly.has(key(target)) ? capabilities.filter(c => c === "reference") : capabilities;
    selected.set(handle, { target, capabilities: granted });
    const p = "value" in value ? value.value.provenance : value.provenance;
    const entry: ProjectedEntity = { handle, kind: target.kind, status: "status" in value ? value.status : "valid", capabilities: granted, origins: sources.origins(p) };
    context.entities.push(entry);
    if ("coreId" in target) entry.core = add({ kind: "CORE", id: target.coreId });
    if ("value" in value) {
      entry.text = value.value.text;
      if ("fromObjectId" in value.value && "toObjectId" in value.value && "coreId" in target) {
        const relation = value.value as { fromObjectId: string; toObjectId: string };
        entry.from = add({ kind: "OBJECT", coreId: target.coreId, id: relation.fromObjectId });
        entry.to = add({ kind: "OBJECT", coreId: target.coreId, id: relation.toObjectId });
      }
      if ("target" in value.value) entry.target = add(value.value.target as SemanticReference);
    } else if (target.kind === "CUE" && "text" in value) {
      entry.text = value.text; entry.cueKind = value.kind;
      if (value.target) entry.target = add(value.target);
    }
    return handle;
  };
  const refresh = () => {
    const active = base.state.cue.active && handleFor({ kind: "CUE", id: base.state.cue.active.id });
    context.cue = { presence: !base.state.cue.active ? "absent" : active ? "included" : "omitted", active: active ?? null };
    for (const entry of context.entities.filter(e => e.kind === "CORE")) {
      const target = selected.get(entry.handle)!.target;
      const core = base.state.knowledge.cores[target.id]!;
      const total = Object.keys(core.objects).length + Object.keys(core.relations).length + Object.keys(core.supports).length;
      entry.contents = context.entities.filter(e => e.core === entry.handle).length === total ? "complete" : "partial";
    }
    context.knowledge.cores = context.entities.filter(e => e.kind === "CORE").length === Object.keys(base.state.knowledge.cores).length ? "complete" : "partial";
  };
  const admit = (root: SemanticReference, mandatory: boolean, anchor?: SemanticReference) => {
    const beforeEntities = structuredClone(context.entities), beforeSelected = structuredClone(selected);
    const beforeCandidates = [...context.candidates];
    const result = add(root);
    if (anchor) {
      add(anchor);
      if (!readOnly.has(key(root))) {
        const capabilities: Capability[] = ["reference", "append", "refocus"];
        selected.get(result)!.capabilities = capabilities;
        context.entities.find(e => e.handle === result)!.capabilities = capabilities;
      }
      context.candidates.push(result);
    }
    refresh();
    if (fits()) return result;
    context.entities = beforeEntities; context.candidates = beforeCandidates; selected.clear(); beforeSelected.forEach((v, k) => selected.set(k, v)); refresh();
    if (mandatory) throw new Error("core-context-required-budget-exceeded");
    return undefined;
  };
  if (base.state.knowledge.currentCoreId) context.knowledge.current = admit({ kind: "CORE", id: base.state.knowledge.currentCoreId }, true)!;
  if (base.state.cue.active && options.includeCue !== false) {
    context.cue.active = admit({ kind: "CUE", id: base.state.cue.active.id }, true)!; context.cue.presence = "included";
  }
  for (const root of [...(options.required ?? []), ...(options.writable ?? [])]) admit(root, true);
  if (!fits()) throw new Error("core-context-required-budget-exceeded");
  for (const prior of (options.structuralPriors ?? []).slice(0, budgets.priors)) {
    context.structuralPriors.push(prior);
    if (!fits()) context.structuralPriors.pop();
  }
  // Retrieval ranks candidates; it does not decide a Core boundary or claim search completeness.
  const query = [...options.newEvidence.map(c => c.text), ...(options.unresolved ?? []).map(u => u.phrase)].join(" ").toLowerCase();
  const terms = new Set(query.match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const score = (text: string) => [...terms].filter(t => text.toLowerCase().includes(t)).length;
  const cores = Object.values(base.state.knowledge.cores);
  const parked = cores.filter(c => c.id !== base.state.knowledge.currentCoreId).map(c => ({ core: c, score: Math.max(0, ...Object.values(c.objects).filter(o => o.status === "valid").map(o => score(o.value.text))) }))
    .filter(c => c.score > 0).sort((a, b) => b.score - a.score || a.core.id.localeCompare(b.core.id)).slice(0, budgets.candidateCores);
  for (const item of parked) {
    const anchor = Object.values(item.core.objects).filter(o => o.status === "valid").sort((a, b) => score(b.value.text) - score(a.value.text) || a.id.localeCompare(b.id))[0];
    // Identity, accepted meaning, candidate metadata and Core authority fit together or roll back together.
    if (anchor) admit({ kind: "CORE", id: item.core.id }, false, { kind: "OBJECT", coreId: item.core.id, id: anchor.id });
  }
  const chosenCores = cores.filter(c => handleFor({ kind: "CORE", id: c.id }));
  const roots = chosenCores.flatMap(c => (["OBJECT", "RELATION", "SUPPORT"] as const).flatMap(kind => {
    const units = c[kind === "OBJECT" ? "objects" : kind === "RELATION" ? "relations" : "supports"];
    return Object.values(units).map((unit, index) => ({ target: { kind, coreId: c.id, id: unit.id }, score: score(unit.value.text), index }));
  })).sort((a, b) => b.score - a.score || b.index - a.index || key(a.target).localeCompare(key(b.target)));
  for (const root of roots.slice(0, budgets.optionalRoots)) admit(root.target, false);
  const history = base.checkpoints.filter(c => c.lessonSequence <= base.state.processedThroughSequence);
  for (const checkpoint of (budgets.recentEvidence ? history.slice(-budgets.recentEvidence) : []).reverse()) {
    const handle = addEvidence(checkpoint, "history");
    if (!fits()) { evidence.delete(handle); context.evidence.pop(); }
  }
  for (const unresolved of (options.unresolved ?? []).slice(0, budgets.unresolved)) {
    const checkpoint = base.checkpoints.find(c => c.checkpointId === unresolved.checkpointId && c.lessonSequence <= options.newEvidence.at(-1)!.lessonSequence);
    if (!checkpoint || !checkpoint.text.includes(unresolved.phrase) || !unresolved.phrase.trim()) throw new Error("core-context-unresolved-evidence-invalid");
    const prior = evidence.size, h = addEvidence(checkpoint, options.newEvidence.some(c => c.checkpointId === checkpoint.checkpointId) ? "new" : "history");
    context.unresolved.push({ evidence: h, phrase: unresolved.phrase });
    if (!fits()) { context.unresolved.pop(); if (evidence.size !== prior) { evidence.delete(h); context.evidence.pop(); } }
  }
  const events = budgets.recentChanges ? base.events.filter(e => e.type === "core.step_accepted").slice(-budgets.recentChanges) : [];
  for (const event of events) {
    if (event.type !== "core.step_accepted") continue;
    const changes: InterpretationContext["recentChanges"][number]["changes"] = [];
    for (const op of event.step.knowledgeOps) {
      const ref: SemanticReference = "target" in op ? op.target : op.action === "SET_CURRENT_CORE" ? { kind: "CORE", id: op.coreId }
        : op.action === "CREATE_CORE" ? { kind: "CORE", id: op.id }
        : { kind: op.action.endsWith("OBJECT") ? "OBJECT" : op.action.endsWith("RELATION") ? "RELATION" : "SUPPORT", coreId: op.coreId, id: op.id };
      const target = handleFor(ref);
      const replacement = op.action === "SUPERSEDE" ? handleFor(op.replacement) : undefined;
      if (target && (op.action !== "SUPERSEDE" || replacement)) changes.push({ action: op.action, target, ...(replacement ? { replacement } : {}) });
    }
    context.recentChanges.push({ changes, complete: changes.length === event.step.knowledgeOps.length, consumedSequences: event.step.consumesCheckpointIds.map(id => base.checkpoints.find(c => c.checkpointId === id)!.lessonSequence) });
    if (!fits()) context.recentChanges.pop();
  }
  refresh();
  if (!fits()) throw new Error("core-context-required-budget-exceeded");
  return { requestId: options.requestId, base, context, entities: selected, evidence, newEvidenceIds: options.newEvidence.map(c => c.checkpointId), domainRules: rules };
}
