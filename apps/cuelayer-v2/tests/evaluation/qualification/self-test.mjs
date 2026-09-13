import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadMicroCorpus,
  validateMicroCorpus,
  corpusIdentity,
} from "./contract.mjs";
const corpus = await loadMicroCorpus();
const changed = (fn) => {
  const value = structuredClone(corpus);
  fn(value);
  return value;
};
test("26 independent authored cases retain their paired distinctions and stable identities", () => {
  const result = corpusIdentity(corpus);
  assert.equal(result.cases, 26);
  assert.equal(result.pairs, 13);
  assert.equal(result.review_status, "REVIEWED");
  assert.equal(
    result.corpus_sha256,
    corpusIdentity(structuredClone(corpus)).corpus_sha256,
  );
});
test("oracle evidence must exist and cannot refer to a future paired case", () => {
  assert.throws(
    () =>
      validateMicroCorpus(
        changed(
          (c) =>
            (c.pairs[0].cases[0].oracle.required[0].evidence_refs = [
              "outside",
            ]),
        ),
      ),
    /unknown-evidence/,
  );
});
test("duplicate cases or setup coverage cannot silently multiply or reconsume evidence", () => {
  assert.throws(
    () =>
      validateMicroCorpus(
        changed(
          (c) => (c.pairs[0].cases[1].case_id = c.pairs[0].cases[0].case_id),
        ),
      ),
    /duplicate-case/,
  );
  assert.throws(
    () =>
      validateMicroCorpus(
        changed((c) => (c.pairs[2].cases[0].setup[1].evidence_refs = ["e0"])),
      ),
    /duplicate-setup-evidence/,
  );
});
test("setup must be an ordered prefix and keep Live evidence to interpret", () => {
  assert.throws(
    () =>
      validateMicroCorpus(
        changed((c) => (c.pairs[2].cases[0].setup[0].evidence_refs = ["e1"])),
      ),
    /duplicate-setup-evidence|setup-not-contiguous-prefix/,
  );
  assert.throws(
    () =>
      validateMicroCorpus(
        changed(
          (c) =>
            (c.pairs[0].cases[0].setup = [
              { action: "NO_CHANGE", evidence_refs: ["e0"] },
            ]),
        ),
      ),
    /no-live-process/,
  );
});
test("field oracles reject contradictory evidence and uncaptured setup sources", () => {
  assert.throws(
    () =>
      validateMicroCorpus(
        changed(
          (c) =>
            (c.pairs[9].cases[0].oracle.field_grounding[0].forbidden_evidence =
              ["e3"]),
        ),
      ),
    /contradictory-field-evidence/,
  );
  assert.throws(
    () =>
      validateMicroCorpus(
        changed(
          (c) =>
            (c.pairs[9].cases[0].setup[0].field_sources.pressure.expression = [
              "e3",
            ]),
        ),
      ),
    /field-outside-setup/,
  );
});
test("source review and ordinary Stage outcomes remain separate from Live response shapes", () => {
  const cases = corpus.pairs.find(
    (p) => p.pair_id === "terminal-source-review",
  ).cases;
  assert.deepEqual(
    cases.map((c) => c.oracle.allowed_dispositions),
    [["CARRY"], ["CONFIRMED_NO_CHANGE"]],
  );
  assert.throws(
    () =>
      validateMicroCorpus(
        changed(
          (c) =>
            (c.pairs[0].cases[0].oracle.allowed_dispositions = ["RESOLVED"]),
        ),
      ),
    /wrong-lane-disposition/,
  );
});
