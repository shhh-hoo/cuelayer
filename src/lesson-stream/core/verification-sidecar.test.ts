import { expect, it } from "vitest";
import { buildCoreInterpretationContext } from "./interpretation-context.ts";
import { acceptCoreInterpretation } from "./interpretation-validation.ts";
import { coreProposalSchema, providerCoreProposalSchema, type ProposalStep } from "./interpretation-proposal.ts";
import { evidence, start, timestamp } from "./test-fixtures.ts";

const step = (): ProposalStep => ({
  consumes: ["e0"], knowledgeOps: [], cueDelta: { action: "KEEP" }, evidenceRefs: [], readRefs: [],
  reads: { knowledge: false, cue: false }, warnings: [],
});
const binding = () => { const base = evidence(start()); return buildCoreInterpretationContext(base, { requestId: "verification-sidecar", newEvidence: base.checkpoints }); };

it("accepts semantics and consumes evidence while returning a grounded verification sidecar", () => {
  const request = binding();
  const plain = acceptCoreInterpretation(request, { outcome: { kind: "PROPOSE", steps: [step()] } }, timestamp);
  const withVerification = acceptCoreInterpretation(request, { outcome: { kind: "PROPOSE", steps: [step()], verificationRequests: [{
    evidence: ["e0"], query: "Compare A and B", claim: "A and B may require an independent factual check.", candidateEvidence: "Check a trusted domain reference.",
  }] } }, timestamp);
  expect(withVerification.replay).toEqual(plain.replay);
  expect(withVerification.events).toEqual(plain.events);
  expect(withVerification.replay.state.processedThroughSequence).toBe(1);
  expect(withVerification.verificationRequests).toEqual([{
    requestIndex: 0, query: "Compare A and B", claim: "A and B may require an independent factual check.", candidateEvidence: "Check a trusted domain reference.",
    checkpointIds: [request.base.checkpoints[0]!.checkpointId],
  }]);
});

it("drops malformed or ungrounded verification sidecars without rolling back semantic acceptance", () => {
  const request = binding();
  const result = acceptCoreInterpretation(request, { outcome: { kind: "PROPOSE", steps: [step()], verificationRequests: [
    42,
    { evidence: ["missing"], query: "Compare A and B", claim: "Unknown evidence.", candidateEvidence: "Check something." },
    { evidence: ["e0"], query: "phrase not present", claim: "Bad query.", candidateEvidence: "Check something." },
  ] } }, timestamp);
  expect(result.kind).toBe("PROPOSE");
  expect(result.events).toHaveLength(1);
  expect(result.replay.state.processedThroughSequence).toBe(1);
  expect(result.verificationRequests).toEqual([]);
});

it("removes blocking NEEDS_VERIFICATION from the internal outcome contract", () => {
  expect(coreProposalSchema.safeParse({ outcome: { kind: "NEEDS_VERIFICATION", evidence: ["e0"], query: "Compare A", claim: "A", candidateEvidence: "B" } }).success).toBe(false);
});

it("keeps provider PROPOSE strict by requiring an explicit verificationRequests array", () => {
  const without = { outcome: { kind: "PROPOSE", steps: [step()] } };
  const withEmpty = { outcome: { kind: "PROPOSE", steps: [step()], verificationRequests: [] } };
  expect(providerCoreProposalSchema.safeParse(without).success).toBe(false);
  expect(providerCoreProposalSchema.safeParse(withEmpty).success).toBe(true);
});
