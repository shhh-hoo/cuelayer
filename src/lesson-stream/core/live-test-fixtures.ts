import type { CanonicalSpeechSpan } from "../../session/speech-types.ts";
import type { CoreEvent } from "./contracts.ts";
import type { CoreInterpretationBinding } from "./interpretation-context.ts";
import type { CoreProposal, ProposalStep } from "./interpretation-proposal.ts";
import type { CoreEventStore } from "./runtime.ts";

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export class MemoryCoreStore implements CoreEventStore {
  events: CoreEvent[] = [];
  beforeAppend?: (events: readonly CoreEvent[], signal?: AbortSignal) => Promise<void>;
  async readSession() { return structuredClone(this.events); }
  async append(events: readonly CoreEvent[], signal?: AbortSignal) {
    signal?.throwIfAborted();
    await this.beforeAppend?.(events, signal);
    signal?.throwIfAborted();
    this.events.push(...structuredClone(events));
  }
}
export function closedSpan(id = "span-1", text = "Synthetic A relates to B."): CanonicalSpeechSpan {
  return { id, revision: 1, sourceFinalIds: [`final-${id}`], text, words: [{ text, startMs: 0, endMs: 100 }],
    startMs: 0, endMs: 100, openedAtMs: 0, updatedAtMs: 100, status: "closed", closeReason: "terminal_punctuation" };
}
export function proposalFor(binding: Pick<CoreInterpretationBinding, "context">, grow = false, sidecar = false): CoreProposal {
  const handles = binding.context.evidence.filter(e => e.consumption === "new").map(e => e.handle);
  const p = { speech: [handles[0]!], state: [], domain: null };
  const ref = (created: string) => ({ created });
  const step: ProposalStep = { consumes: handles, knowledgeOps: [], cueDelta: { action: "KEEP" },
    evidenceRefs: [handles[0]!], readRefs: [], reads: { knowledge: false, cue: false }, warnings: [] };
  if (grow) step.knowledgeOps = [
    { action: "CREATE_CORE", as: "main", provenance: p },
    { action: "ADD_OBJECT", core: ref("main"), as: "a", value: { text: "A", provenance: p } },
    { action: "ADD_OBJECT", core: ref("main"), as: "b", value: { text: "B", provenance: p } },
    { action: "ADD_RELATION", core: ref("main"), as: "rel", value: { text: "A relates to B", provenance: p, from: ref("a"), to: ref("b") } },
    { action: "SET_CURRENT_CORE", core: ref("main") },
  ];
  return { outcome: { kind: "PROPOSE", steps: [step], verificationRequests: sidecar ? [{ evidence: [handles[0]!],
    query: binding.context.evidence[0]!.text, claim: "Check this claim", candidateEvidence: "Investigation lead only" }] : [] } };
}
export function proposedStep(proposal: CoreProposal) {
  if (proposal.outcome.kind !== "PROPOSE") throw new Error("test-propose-required");
  return proposal.outcome.steps[0]!;
}
export function addCue(proposal: CoreProposal, target: "CORE" | "OBJECT" | "RELATION" | null = null, origin: "AI" | "TEACHER" = "AI") {
  const step = proposedStep(proposal), evidence = step.consumes[0]!;
  step.cueDelta = { action: "SET", as: "note", value: { kind: "NOTE", text: "Consider this relationship.",
    target: target ? { created: target === "CORE" ? "main" : target === "OBJECT" ? "a" : "rel" } : null,
    provenance: { speech: [evidence], state: [], domain: null },
    origin: origin === "AI" ? { kind: "AI", trigger: evidence, rationale: "Relevant retrieval prompt." } : { kind: "TEACHER", evidence } } };
  return proposal;
}
