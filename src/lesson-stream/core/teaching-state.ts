import type { CompactEvidenceCheckpoint, SpeechReference } from "../contracts.ts";
import { coreStepSchema, type Core, type CoreTeachingState, type CoreStep, type KnowledgeOperation, type Provenance, type SemanticReference, type UnitReference } from "./contracts.ts";
import { coreEntityId } from "./events.ts";

export function createCoreTeachingState(sessionId: string): CoreTeachingState {
  if (!sessionId) throw new Error("core-session-id-required");
  return { sessionId, processedThroughSequence: 0, knowledge: { revision: 0, cores: {} }, cue: { revision: 0 } };
}

const collection = { OBJECT: "objects", RELATION: "relations", SUPPORT: "supports" } as const;
export function resolveSemanticReference(state: CoreTeachingState, ref: SemanticReference) {
  if (ref.kind === "CUE") return state.cue.active?.id === ref.id ? state.cue.active : undefined;
  if (ref.kind === "CORE") return Object.hasOwn(state.knowledge.cores, ref.id) ? state.knowledge.cores[ref.id] : undefined;
  const core = state.knowledge.cores[ref.coreId];
  const units = core?.[collection[ref.kind]];
  return units && Object.hasOwn(units, ref.id) ? units[ref.id] : undefined;
}

function requireReference(state: CoreTeachingState, ref: SemanticReference, valid = true) {
  const value = resolveSemanticReference(state, ref);
  if (!value || (valid && "status" in value && value.status !== "valid")) throw new Error("core-reference-invalid");
  return value;
}

function provenances(step: CoreStep): Provenance[] {
  return [...step.knowledgeOps.flatMap(op => "value" in op ? [op.value.provenance] : "provenance" in op ? [op.provenance] : []),
    ...("value" in step.cueDelta ? [step.cueDelta.value.provenance] : [])];
}

function validateStepBase(state: CoreTeachingState, step: CoreStep, checkpoints: readonly CompactEvidenceCheckpoint[]) {
  const pending = checkpoints.filter(c => c.lessonSequence > state.processedThroughSequence).sort((a, b) => a.lessonSequence - b.lessonSequence);
  if (step.consumesCheckpointIds.some((id, i) => pending[i]?.checkpointId !== id)
    || new Set(step.consumesCheckpointIds).size !== step.consumesCheckpointIds.length) throw new Error("core-evidence-prefix-invalid");
  const through = pending[step.consumesCheckpointIds.length - 1]!.lessonSequence;
  const available = new Map(checkpoints.filter(c => c.lessonSequence <= through).map(c => [c.checkpointId, c]));
  const current = new Set(step.consumesCheckpointIds);
  const speech = (ref: SpeechReference, currentOnly = false) => {
    if (!available.get(ref.checkpointId)?.text.includes(ref.quote) || !ref.quote.trim()
      || (currentOnly && !current.has(ref.checkpointId))) throw new Error("core-speech-reference-invalid");
  };
  const sources = provenances(step);
  const stateRefs = [...step.stateRefs, ...sources.flatMap(p => p.stateRefs)];
  const cue = step.cueDelta;
  const readsKnowledge = stateRefs.some(r => r.target.kind !== "CUE") || ("value" in cue && cue.value.target !== undefined);
  const readsCue = stateRefs.some(r => r.target.kind === "CUE");
  if (step.baseKnowledgeRevision > state.knowledge.revision || step.baseCueRevision > state.cue.revision) throw new Error("core-base-revision-ahead");
  if ((step.knowledgeOps.length > 0 || readsKnowledge) && step.baseKnowledgeRevision !== state.knowledge.revision) throw new Error("core-knowledge-conflict");
  if ((cue.action !== "KEEP" || readsCue) && step.baseCueRevision !== state.cue.revision) throw new Error("core-cue-conflict");
  for (const ref of stateRefs) {
    const actual = ref.target.kind === "CUE" ? state.cue.revision : state.knowledge.revision;
    if (ref.revision !== actual) throw new Error("core-provenance-revision-invalid");
    // Provenance addresses one accepted base snapshot. Same-step structural references
    // are allowed below, but are never mislabeled as prior accepted knowledge.
    requireReference(state, ref.target);
  }
  step.evidenceRefs.forEach(ref => speech(ref));
  sources.forEach(p => p.speechRefs.forEach(ref => speech(ref)));
  if ((step.knowledgeOps.length > 0 || cue.action !== "KEEP") && !step.evidenceRefs.some(r => current.has(r.checkpointId))) throw new Error("core-current-trigger-required");
  for (const op of step.knowledgeOps) if ("correctionEvidence" in op && op.correctionEvidence) speech(op.correctionEvidence, true);
  if ("value" in cue && !cue.value.provenance.speechRefs.some(r => current.has(r.checkpointId))) throw new Error("core-cue-current-speech-required");
  if ("evidence" in cue) speech(cue.evidence, true);
  return through;
}

function replaceCore(state: CoreTeachingState, core: Core): CoreTeachingState {
  return { ...state, knowledge: { ...state.knowledge, cores: { ...state.knowledge.cores, [core.id]: core } } };
}

function applyOperation(state: CoreTeachingState, op: KnowledgeOperation, step: CoreStep, index: number): CoreTeachingState {
  if (op.action === "CREATE_CORE") {
    if (op.id !== coreEntityId(state.sessionId, step, "CORE", index) || Object.hasOwn(state.knowledge.cores, op.id)) throw new Error("core-creation-identity-invalid");
    return replaceCore(state, { id: op.id, provenance: op.provenance, objects: {}, relations: {}, supports: {} });
  }
  if (op.action === "SET_CURRENT_CORE") {
    requireReference(state, { kind: "CORE", id: op.coreId });
    return state.knowledge.currentCoreId === op.coreId ? state : { ...state, knowledge: { ...state.knowledge, currentCoreId: op.coreId } };
  }
  if (op.action === "INVALIDATE" || op.action === "SUPERSEDE") {
    const unit = requireReference(state, op.target);
    if (!("status" in unit)) throw new Error("core-unit-required");
    if (op.action === "SUPERSEDE") {
      if (op.target.coreId !== op.replacement.coreId || op.target.kind !== op.replacement.kind || op.target.id === op.replacement.id) throw new Error("core-supersession-target-invalid");
      requireReference(state, op.replacement);
    }
    const core = state.knowledge.cores[op.target.coreId]!;
    const key = collection[op.target.kind];
    const replacement = op.action === "INVALIDATE" ? { ...unit, status: "invalidated" as const }
      : { ...unit, status: "superseded" as const, supersededBy: op.replacement };
    return replaceCore(state, { ...core, [key]: { ...core[key], [op.target.id]: replacement } });
  }
  const kind = op.action.endsWith("OBJECT") ? "OBJECT" : op.action.endsWith("RELATION") ? "RELATION" : "SUPPORT";
  const ref: UnitReference = { kind, coreId: op.coreId, id: op.id };
  requireReference(state, { kind: "CORE", id: op.coreId });
  const core = state.knowledge.cores[op.coreId]!;
  const key = collection[kind];
  if (op.action.startsWith("ADD_")) {
    if (op.id !== coreEntityId(state.sessionId, step, kind, index) || resolveSemanticReference(state, ref)) throw new Error("core-creation-identity-invalid");
  } else {
    requireReference(state, ref);
  }
  if ("fromObjectId" in op.value) {
    requireReference(state, { kind: "OBJECT", coreId: op.coreId, id: op.value.fromObjectId });
    requireReference(state, { kind: "OBJECT", coreId: op.coreId, id: op.value.toObjectId });
  }
  if ("target" in op.value) {
    const target = op.value.target;
    if ((target.kind === "CORE" ? target.id : target.coreId) !== op.coreId || target.kind === "SUPPORT") throw new Error("core-support-target-invalid");
    requireReference(state, target);
  }
  const previous = resolveSemanticReference(state, ref);
  if (previous && "value" in previous && JSON.stringify(previous.value) === JSON.stringify(op.value)) return state;
  return replaceCore(state, { ...core, [key]: { ...core[key], [op.id]: { id: op.id, value: op.value, status: "valid" } } });
}

/** Pure atomic boundary: intermediate copies never escape and the accepted base is never mutated. */
export function reduceCoreStep(state: CoreTeachingState, input: unknown, checkpoints: readonly CompactEvidenceCheckpoint[]): CoreTeachingState {
  const step = coreStepSchema.parse(input);
  const through = validateStepBase(state, step, checkpoints);
  let next = state;
  for (const [index, op] of step.knowledgeOps.entries()) next = applyOperation(next, op, step, index);
  const delta = step.cueDelta;
  if (delta.action !== "KEEP") {
    if (delta.action === "SET") {
      if (state.cue.active) throw new Error("core-cue-already-active");
    } else if (state.cue.active?.id !== delta.targetCueId) throw new Error("core-cue-target-invalid");
    if (delta.action === "RESOLVE") next = { ...next, cue: { revision: state.cue.revision + 1 } };
    else {
      if (delta.action === "REVISE" && delta.value.kind !== state.cue.active!.kind) throw new Error("core-cue-kind-change-needs-replacement");
      const cueId = delta.action === "REVISE" ? delta.targetCueId : delta.id;
      if (delta.action !== "REVISE" && cueId !== coreEntityId(state.sessionId, step, "CUE", step.knowledgeOps.length)) throw new Error("core-creation-identity-invalid");
      if (delta.value.target) requireReference(next, delta.value.target);
      const active = { id: cueId, ...delta.value };
      if (JSON.stringify(active) !== JSON.stringify(state.cue.active)) next = { ...next, cue: { revision: state.cue.revision + 1, active } };
    }
  }
  return { ...next, processedThroughSequence: through,
    knowledge: next.knowledge === state.knowledge ? state.knowledge : { ...next.knowledge, revision: state.knowledge.revision + 1 } };
}
