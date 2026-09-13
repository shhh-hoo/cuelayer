import test from "node:test";
import assert from "node:assert/strict";
import { loadMicroCorpus, corpusIdentity } from "./contract.mjs";
import {
  actualDisposition,
  fieldProvenanceScore,
  exportReviewPacket,
  importAdjudication,
} from "./adjudication.mjs";
import { sha256 } from "../evidence.mjs";
const corpus = await loadMicroCorpus();
const cases = corpus.pairs.flatMap((p) => p.cases);
function fixture(caseId = "quantity-explicit-fields") {
  const specification = cases.find((c) => c.case_id === caseId);
  assert.ok(specification, caseId);
  const snapshot = {
    snapshot_id: caseId,
    task: { lane: specification.lane },
    request: { source: specification.evidence },
    prestate: { state: { units: {} } },
    unit_keys: {},
  };
  const manifest = {
    corpus: corpusIdentity(corpus),
    trials: [
      {
        trial_id: "trial-1",
        snapshot_id: caseId,
        candidate_id: "test-candidate",
      },
    ],
  };
  const verified = { manifest, corpus, snapshots: [snapshot] };
  const row = {
    trial_id: "trial-1",
    case_id: caseId,
    candidate_id: "test-candidate",
    parser: {
      success: true,
      value: { groups: [{ outcome: "APPLY" }], suffixStatus: "NONE" },
    },
    attempts: [{ host_accepted: true }],
    poststate: {
      state: {
        units: {
          u1: {
            fieldBasis: {
              expression: [{ evidenceId: "e0" }],
              symbols: [{ evidenceId: "e1" }],
              conditions: [{ evidenceId: "e0" }],
            },
          },
        },
      },
    },
  };
  const empty = {
    identity: "cuelayer-v2-semantic-adjudication-1",
    manifest_sha256: sha256(manifest),
    oracle_sha256: manifest.corpus.oracle_sha256,
    adjudicator: "independent-offline-review-fixture",
    reviews: [],
  };
  return { verified, row, empty, specification, snapshot };
}
function reviewed(f) {
  const packet = exportReviewPacket(f.verified, [f.row]),
    entry = packet.trials[0];
  return {
    ...f.empty,
    reviews: [
      {
        trial_id: entry.trial_id,
        response_sha256: entry.response_sha256,
        bindings: Object.fromEntries(entry.binding_keys.map((k) => [k, "u1"])),
        decisions: entry.required_decisions.map((c) => ({
          id: c.id,
          verdict: "PASS",
          reason:
            "Authored known-good response preserves the cited requirement.",
          evidence_refs: c.evidence_refs,
          output_paths: ["/poststate", "/parser/value"],
        })),
      },
    ],
  };
}
test("parser success alone leaves semantic mutation and accepted end-state pending", () => {
  const f = fixture(),
    row = importAdjudication(f.verified, [f.row], f.empty)[0];
  assert.equal(row.semantic_scores.disposition, "PASS");
  assert.equal(row.semantic_scores.knowledge_mutation, "PENDING");
  assert.equal(row.semantic_scores.end_state, "PENDING");
  assert.equal(row.semantic_scores.provenance, "PENDING");
});
test("reviewed semantic role plus exact field evidence passes; later-unit evidence corruption fails", () => {
  const f = fixture();
  let row = importAdjudication(f.verified, [f.row], reviewed(f))[0];
  assert.equal(row.semantic_scores.provenance, "PASS");
  assert.equal(row.semantic_scores.knowledge_mutation, "PASS");
  assert.equal(row.semantic_scores.end_state, "PASS");
  f.row.poststate.state.units.u1.fieldBasis.symbols = [{ evidenceId: "e0" }];
  row = importAdjudication(f.verified, [f.row], reviewed(f))[0];
  assert.equal(row.semantic_scores.provenance, "FAIL");
});
test("known existing identity and forbidden old field basis are checked without prose matching", () => {
  const specification = cases.find((c) =>
    c.oracle.field_grounding.some((r) => r.forbidden_evidence.length),
  );
  const f = fixture(specification.case_id);
  f.snapshot.unit_keys = Object.fromEntries(
    specification.oracle.field_grounding.map((r) => [r.unit_key, "u1"]),
  );
  f.row.poststate.state.units.u1.fieldBasis = Object.fromEntries(
    specification.oracle.field_grounding.map((r) => [
      r.field,
      r.required_evidence.map((evidenceId) => ({ evidenceId })),
    ]),
  );
  assert.equal(
    fieldProvenanceScore(specification, f.snapshot, f.row).status,
    "PASS",
  );
  const rule = specification.oracle.field_grounding.find(
    (r) => r.forbidden_evidence.length,
  );
  f.row.poststate.state.units.u1.fieldBasis[rule.field].push({
    evidenceId: rule.forbidden_evidence[0],
  });
  assert.equal(
    fieldProvenanceScore(specification, f.snapshot, f.row).status,
    "FAIL",
  );
});
test("known false terminal response fails disposition and false-terminal rate", () => {
  const specification = cases.find(
    (c) =>
      c.lane === "Live" && !c.oracle.allowed_dispositions.includes("NO_CHANGE"),
  );
  const f = fixture(specification.case_id);
  f.row.parser.value.groups = [{ outcome: "NO_CHANGE" }];
  const row = importAdjudication(f.verified, [f.row], f.empty)[0];
  assert.equal(row.semantic_scores.disposition, "FAIL");
  assert.equal(row.semantic_scores.false_terminal_no_change, "FAIL");
});
test("mixed APPLY plus NO_CHANGE requires explicit source-slice terminal review", () => {
  const f = fixture();
  f.row.parser.value.groups.push({ outcome: "NO_CHANGE" });
  let row = importAdjudication(f.verified, [f.row], f.empty)[0];
  assert.equal(row.semantic_scores.false_terminal_no_change, "PENDING");
  const input = reviewed(f);
  input.reviews[0].decisions.find((d) => d.id === "false-terminal").verdict =
    "FAIL";
  row = importAdjudication(f.verified, [f.row], input)[0];
  assert.equal(row.semantic_scores.false_terminal_no_change, "FAIL");
});
test("host rejection preserves proposal review while accepted-state provenance remains unavailable", () => {
  const f = fixture();
  f.row.attempts = [{ host_accepted: false }];
  const input = reviewed(f);
  input.reviews[0].decisions.find((d) => d.id === "end-state").verdict = "FAIL";
  const row = importAdjudication(f.verified, [f.row], input)[0];
  assert.equal(row.semantic_scores.knowledge_mutation, "PASS");
  assert.equal(row.semantic_scores.end_state, "FAIL");
  assert.equal(row.semantic_scores.provenance, "UNAVAILABLE");
});
test("timeout before parsing has no fabricated semantic score or review packet", () => {
  const f = fixture();
  f.row.parser = { success: false, output_text: null };
  f.row.attempts = [{ host_accepted: false }];
  assert.deepEqual(exportReviewPacket(f.verified, [f.row]).trials, []);
  const row = importAdjudication(f.verified, [f.row], f.empty)[0];
  for (const metric of f.specification.oracle.applicable_metrics)
    assert.equal(row.semantic_scores[metric], "UNAVAILABLE");
});
test("adjudication rejects changed oracle/response, missing checks, unsupported evidence and dangling paths", () => {
  const f = fixture(),
    good = reviewed(f);
  for (const mutate of [
    (x) => (x.oracle_sha256 = "bad"),
    (x) => (x.reviews[0].response_sha256 = "bad"),
    (x) => x.reviews[0].decisions.pop(),
    (x) => (x.reviews[0].decisions[0].evidence_refs = ["outside"]),
    (x) => (x.reviews[0].decisions[0].output_paths = ["/missing"]),
    (x) => x.reviews.push(x.reviews[0]),
    (x) => (x.reviews[0].bindings = { "new-pressure": "outside" }),
  ]) {
    const input = structuredClone(good);
    mutate(input);
    assert.throws(
      () => importAdjudication(f.verified, [f.row], input),
      /adjudication-/,
    );
  }
});
test("unresolved human judgment remains pending and a known bad assertion fails", () => {
  const f = fixture(),
    input = reviewed(f);
  input.reviews[0].decisions.find((d) => d.id === "all-mutations").verdict =
    "UNRESOLVED";
  assert.equal(
    importAdjudication(f.verified, [f.row], input)[0].semantic_scores
      .knowledge_mutation,
    "PENDING",
  );
  input.reviews[0].decisions.find((d) => d.id === "all-mutations").verdict =
    "FAIL";
  assert.equal(
    importAdjudication(f.verified, [f.row], input)[0].semantic_scores
      .knowledge_mutation,
    "FAIL",
  );
});
test("Stage source outcomes and waiting remain explicit dispositions", () => {
  assert.equal(
    actualDisposition({
      parser: {
        success: true,
        value: { results: [{ outcome: "READY_FOR_LIVE" }] },
      },
    }),
    "READY_FOR_LIVE",
  );
  assert.equal(
    actualDisposition({
      parser: {
        success: true,
        value: { groups: [], suffixStatus: "WAIT_MORE_INPUT" },
      },
    }),
    "WAIT",
  );
});

test("actual product capture and host acceptance retain P=90, kPa and sealed-vessel field provenance", async () => {
  const { resolve } = await import("node:path");
  const { evaluatorRoot } = await import("../manifest.mjs");
  const { Provenance, git } = await import("../provenance.mjs");
  const { loadSharedExecutionProduct } =
    await import("../shared-execution-manifest.mjs");
  const { generateMicroSnapshots } = await import("./capture.mjs");
  const productRoot =
    process.env.GATE3B_QUALIFICATION_PRODUCT_ROOT ??
    resolve(evaluatorRoot, "../cuelayer-v2-terminal-review57");
  const product = await loadSharedExecutionProduct(
    new Provenance(productRoot, evaluatorRoot, {
      productSha: git(productRoot, "rev-parse", "HEAD"),
      allowDirtyEvaluator: true,
    }),
  );
  const snapshot = (await generateMicroSnapshots(product, corpus)).find(
    (s) => s.snapshot_id === "quantity-explicit-fields",
  );
  const task = snapshot.task,
    r = snapshot.request,
    specification = cases.find((c) => c.case_id === snapshot.snapshot_id);
  const basis = specification.evidence.map((e) =>
    product.fixture.fixtureBasis(task, e.text, r.source.source),
  );
  const meaning = {
    kind: "quantity",
    expression: ["Equal", "P", 90],
    symbols: { P: { label: "pressure", unit: "kPa" } },
    conditions: ["sealed vessel"],
  };
  const put = {
    type: "put",
    id: r.newUnits[0],
    coreId: r.newCores[0],
    meaning: product.wire.projectMeaning(meaning, (x) => x),
    dependencies: [],
    basis: basis[0],
    fieldBasis: [
      { field: "expression", basis: basis[0] },
      { field: "symbols", basis: basis[1] },
      { field: "conditions", basis: basis[0] },
    ],
  };
  const response = {
    scope: task.capture.namespace,
    groups: [
      {
        outcome: "APPLY",
        throughBoundary: r.source.end,
        operations: [
          {
            type: "core",
            id: r.newCores[0],
            label: "Vessel pressure",
            basis: basis[0],
          },
          put,
        ],
        resolutions: [],
      },
    ],
    suffixStatus: "NONE",
    contextRequest: null,
    reviewRequests: [],
    attentionCandidate: null,
  };
  const accepted = product.acceptance.validate(
      snapshot.prestate,
      task,
      response,
    ),
    sequence = snapshot.prestate.sequence + 1;
  const event = {
    ...product.acceptanceEvent.decisionEventPayload(task, accepted),
    schema: "cuelayer-v2-event-3",
    sessionId: task.sessionId,
    id: task.sessionId + ":" + sequence,
    sequence,
    at: Date.now(),
  };
  const poststate = product.contract.fold(snapshot.prestate, event),
    unitId = task.capture.units[r.newUnits[0]],
    unit = poststate.state.units[unitId];
  assert.deepEqual(unit.meaning, meaning);
  assert.deepEqual(
    Object.fromEntries(
      ["expression", "symbols", "conditions"].map((k) => [
        k,
        unit.fieldBasis[k].map((b) => b.evidenceId),
      ]),
    ),
    { expression: ["e0"], symbols: ["e1"], conditions: ["e0"] },
  );
  const row = {
    parser: { success: true, value: response },
    attempts: [{ host_accepted: true }],
    poststate,
  };
  const bindings = Object.fromEntries(
    specification.oracle.field_grounding.map((r) => [r.unit_key, unitId]),
  );
  assert.equal(
    fieldProvenanceScore(specification, snapshot, row, bindings).status,
    "PASS",
  );
  const corrupted = structuredClone(row);
  corrupted.poststate.state.units[unitId].fieldBasis.symbols =
    unit.fieldBasis.expression;
  assert.equal(
    fieldProvenanceScore(specification, snapshot, corrupted, bindings).status,
    "FAIL",
  );
  assert.deepEqual(corrupted.poststate.state.units[unitId].meaning, meaning);
});
