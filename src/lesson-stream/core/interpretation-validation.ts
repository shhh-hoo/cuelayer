import { acceptCoreStep } from "./accepted-steps.ts";
import { coreStepSchema, type CoreStep, type KnowledgeOperation, type Provenance, type SemanticReference, type UnitReference } from "./contracts.ts";
import { coreEntityId } from "./events.ts";
import type { Capability, CoreInterpretationBinding } from "./interpretation-context.ts";
import { coreProposalSchema, type ProposalProvenance, type ProposalReference } from "./interpretation-proposal.ts";
import type { CoreReplay } from "./replay.ts";
import { resolveSemanticReference } from "./teaching-state.ts";

/** Offline candidates only. No persistence, provider calls, publication or retry orchestration. */
export function acceptCoreInterpretation(binding: CoreInterpretationBinding, raw: unknown, acceptedAt: string, acceptedBase: CoreReplay = binding.base) {
  const proposal = coreProposalSchema.parse(raw).outcome;
  if (acceptedBase.state.sessionId !== binding.base.state.sessionId) throw new Error("core-proposal-session-mismatch");
  const initialPending = acceptedBase.checkpoints.filter(c => c.lessonSequence > acceptedBase.state.processedThroughSequence);
  if (binding.newEvidenceIds.some((id, i) => initialPending[i]?.checkpointId !== id)) throw new Error("core-proposal-pending-prefix-invalid");
  if (proposal.kind === "NEEDS_CONTEXT") {
    const evidence = proposal.evidence.map(h => {
      const cp = binding.evidence.get(h);
      if (!cp || !binding.newEvidenceIds.includes(cp.checkpointId)) throw new Error("core-proposal-context-evidence-invalid");
      return cp;
    });
    // A retrieval query is a teacher phrase, never a model-generated identity or hidden fact.
    if (!proposal.query.trim() || !evidence.some(cp => cp.text.includes(proposal.query))) throw new Error("core-proposal-context-query-not-evidence");
    return { kind: "NEEDS_CONTEXT" as const, query: proposal.query, checkpointIds: evidence.map(c => c.checkpointId), steps: [], events: [], replay: acceptedBase };
  }
  let replay = acceptedBase, offset = 0;
  let knowledgeRevision = binding.base.state.knowledge.revision, cueRevision = binding.base.state.cue.revision;
  const aliases = new Map<string, { target: SemanticReference; step: number; operation: number }>();
  const steps: CoreStep[] = [], events: ReturnType<typeof acceptCoreStep>["event"][] = [];
  for (const [stepIndex, proposed] of proposal.steps.entries()) {
    const consumes = proposed.consumes.map(h => {
      const checkpoint = binding.evidence.get(h);
      if (!checkpoint) throw new Error("core-proposal-evidence-unknown");
      return checkpoint.checkpointId;
    });
    if (consumes.some((id, i) => binding.newEvidenceIds[offset + i] !== id)) throw new Error("core-proposal-coverage-invalid");
    offset += consumes.length;
    const through = binding.evidence.get(proposed.consumes.at(-1)!)!.lessonSequence;
    const speech = (handle: string, current = false) => {
      const cp = binding.evidence.get(handle);
      const actual = cp && replay.checkpoints.find(c => c.checkpointId === cp.checkpointId);
      if (!cp || JSON.stringify(actual) !== JSON.stringify(cp) || cp.lessonSequence > through || (current && !consumes.includes(cp.checkpointId))) throw new Error("core-proposal-speech-unavailable");
      return { checkpointId: cp.checkpointId, quote: cp.text };
    };
    const resolve = (reference: ProposalReference, capability: Capability = "reference", priorState = false): SemanticReference => {
      let target: SemanticReference;
      if ("existing" in reference) {
        const entity = binding.entities.get(reference.existing);
        if (!entity || !entity.capabilities.includes(capability)) throw new Error("core-proposal-reference-capability-denied");
        target = entity.target;
      } else {
        const creation = aliases.get(reference.created);
        if (!creation || (priorState && creation.step === stepIndex)) throw new Error("core-proposal-creation-reference-invalid");
        target = creation.target;
      }
      if (priorState) {
        const value = resolveSemanticReference(replay.state, target);
        if (!value || ("status" in value && value.status !== "valid")) throw new Error("core-proposal-state-source-invalid");
      }
      return target;
    };
    const requireKind = (ref: ProposalReference, kind: SemanticReference["kind"], capability: Capability = "reference") => {
      const target = resolve(ref, capability);
      if (target.kind !== kind) throw new Error("core-proposal-reference-kind-invalid");
      return target;
    };
    const unit = (ref: ProposalReference, capability: Capability = "reference"): UnitReference => {
      const target = resolve(ref, capability);
      if (!("coreId" in target)) throw new Error("core-proposal-unit-required");
      return target;
    };
    const source = (reference: ProposalReference, capability: "reference" | "factual_basis" = "reference") => {
      const target = resolve(reference, "reference", true);
      if (capability === "factual_basis") {
        if (target.kind === "CORE") throw new Error("core-proposal-core-container-not-factual-basis");
        if (!["OBJECT", "RELATION", "SUPPORT"].includes(target.kind)) throw new Error("core-proposal-state-source-not-factual");
        resolve(reference, capability, true);
      }
      return { target, revision: target.kind === "CUE" ? cueRevision : knowledgeRevision };
    };
    const provenance = (p: ProposalProvenance, text?: string): Provenance => {
      if (p.domain && p.speech.length) throw new Error("core-proposal-domain-not-speech");
      const stateRefs = p.state.map(ref => source(ref, "factual_basis"));
      if (stateRefs.some(r => r.target.kind === "CORE")) throw new Error("core-proposal-core-container-not-factual-basis");
      let domainBasis: string | undefined;
      if (p.domain) {
        if (binding.context.cue.presence === "omitted") throw new Error("core-proposal-domain-needs-cue-context");
        const rule = binding.domainRules.find(r => r.id === p.domain!.rule);
        if (!rule || text !== rule.text) throw new Error("core-proposal-domain-rule-not-authorized");
        domainBasis = `${rule.id}: ${rule.basis}`;
      }
      if (!p.speech.length && !stateRefs.length && !domainBasis) throw new Error("core-proposal-provenance-required");
      return { speechRefs: p.speech.map(h => speech(h)), stateRefs, ...(domainBasis ? { domainBasis } : {}) };
    };
    const identity = { requestId: binding.requestId, stepIndex };
    const create = (alias: string, kind: SemanticReference["kind"], operation: number, coreId?: string): string => {
      if (aliases.has(alias)) throw new Error("core-proposal-alias-duplicate");
      const id = coreEntityId(replay.state.sessionId, identity, kind, operation);
      const target: SemanticReference = kind === "CORE" || kind === "CUE" ? { kind, id } : { kind, id, coreId: coreId! };
      aliases.set(alias, { target, step: stepIndex, operation });
      return id;
    };
    const knowledgeOps: KnowledgeOperation[] = [];
    for (const [index, op] of proposed.knowledgeOps.entries()) {
      if (op.action === "CREATE_CORE") {
        const p = provenance(op.provenance);
        knowledgeOps.push({ action: op.action, id: create(op.as, "CORE", index), provenance: p }); continue;
      }
      if (op.action === "SET_CURRENT_CORE") {
        knowledgeOps.push({ action: op.action, coreId: requireKind(op.core, "CORE", "refocus").id }); continue;
      }
      if (op.action === "INVALIDATE" || op.action === "SUPERSEDE") {
        const target = unit(op.target, op.action === "INVALIDATE" ? "invalidate" : "supersede");
        const correctionEvidence = speech(op.correctionEvidence, true);
        knowledgeOps.push(op.action === "INVALIDATE" ? { action: op.action, target, correctionEvidence }
          : { action: op.action, target, replacement: unit(op.replacement), correctionEvidence }); continue;
      }
      const kind = op.action.endsWith("OBJECT") ? "OBJECT" : op.action.endsWith("RELATION") ? "RELATION" : "SUPPORT";
      const target = "core" in op ? requireKind(op.core, "CORE", "append") : requireKind(op.target, kind, "revise");
      const coreId = "core" in op ? target.id : (target as UnitReference).coreId;
      const value: Record<string, unknown> = { text: op.value.text, provenance: provenance(op.value.provenance, op.value.text) };
      if ("from" in op.value) {
        const from = unit(op.value.from), to = unit(op.value.to);
        if (from.kind !== "OBJECT" || to.kind !== "OBJECT" || from.coreId !== coreId || to.coreId !== coreId) throw new Error("core-proposal-relation-endpoints-invalid");
        value.fromObjectId = from.id; value.toObjectId = to.id;
      }
      if ("target" in op.value) {
        const target = resolve(op.value.target);
        if (!["CORE", "OBJECT", "RELATION"].includes(target.kind) || ("coreId" in target ? target.coreId : target.id) !== coreId) throw new Error("core-proposal-support-target-invalid");
        value.target = target;
      }
      const correction = "correctionEvidence" in op && op.correctionEvidence !== null ? { correctionEvidence: speech(op.correctionEvidence, true) } : {};
      // Register only after resolving all inputs: self/forward references cannot hide in values.
      const id = "as" in op ? create(op.as, kind, index, coreId) : target.id;
      knowledgeOps.push({ action: op.action, coreId, id, value, ...correction } as KnowledgeOperation);
    }
    const cue = proposed.cueDelta;
    let cueDelta: CoreStep["cueDelta"] = { action: "KEEP" };
    if (cue.action !== "KEEP") {
      const targetCueId = "target" in cue ? requireKind(cue.target, "CUE", "revise").id : undefined;
      if (cue.action === "RESOLVE") cueDelta = { action: "RESOLVE", targetCueId: targetCueId!, evidence: speech(cue.evidence, true) };
      else {
        if (cue.value.provenance.domain) throw new Error("core-proposal-cue-domain-forbidden");
        const p = provenance(cue.value.provenance, cue.value.text);
        if (!p.speechRefs.some(r => consumes.includes(r.checkpointId))) throw new Error("core-proposal-cue-current-speech-required");
        const target = cue.value.target ? resolve(cue.value.target) : undefined;
        if (target && !["CORE", "OBJECT", "RELATION"].includes(target.kind)) throw new Error("core-proposal-cue-target-invalid");
        const value = { text: cue.value.text, provenance: p, kind: cue.value.kind, ...(target ? { target: target as Exclude<SemanticReference, { kind: "CUE" }> } : {}) };
        const id = "as" in cue ? create(cue.as, "CUE", knowledgeOps.length) : targetCueId!;
        cueDelta = (cue.action === "SET" ? { action: "SET", id, value } : cue.action === "REVISE" ? { action: "REVISE", targetCueId, value }
          : { action: "REPLACE", targetCueId, id, value, evidence: speech(cue.evidence, true) }) as CoreStep["cueDelta"];
      }
    }
    if (proposed.reads.knowledge && knowledgeRevision !== replay.state.knowledge.revision) throw new Error("core-knowledge-conflict");
    if (proposed.reads.cue && cueRevision !== replay.state.cue.revision) throw new Error("core-cue-conflict");
    const step = coreStepSchema.parse({ ...identity, baseKnowledgeRevision: knowledgeRevision, baseCueRevision: cueRevision,
      consumesCheckpointIds: consumes, knowledgeOps, cueDelta, evidenceRefs: proposed.evidenceRefs.map(h => speech(h)), stateRefs: proposed.readRefs.map(ref => source(ref)),
      warnings: proposed.warnings.map(detail => ({ code: "interpretation_note", detail })), acceptedAt });
    const before = replay.state;
    const accepted = acceptCoreStep(replay, step);
    replay = accepted.replay;
    knowledgeRevision += replay.state.knowledge.revision - before.knowledge.revision;
    cueRevision += replay.state.cue.revision - before.cue.revision;
    steps.push(step); events.push(accepted.event);
  }
  if (offset !== binding.newEvidenceIds.length) throw new Error("core-proposal-coverage-invalid");
  return { kind: "PROPOSE" as const, steps, events, replay };
}
