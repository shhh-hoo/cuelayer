import test from "node:test";
import assert from "node:assert/strict";
import { loadNaturalLesson, validateNaturalLesson } from "./lesson.mjs";
import {
  exportNaturalReview,
  importNaturalReview,
  NATURAL_REQUIRED_MECHANICAL,
} from "./review.mjs";
import { sha256 } from "../evidence.mjs";

const lesson = await loadNaturalLesson();
const clone = (value) => structuredClone(value);
const basis = (event) => [
  {
    evidenceId: "persisted-" + event,
    quote: lesson.transcript_events.find((e) => e.event_id === event).text,
  },
];

// Explicitly authored protocol fixtures, not natural-model performance evidence.
function fixture() {
  const pressure = {
    id: "accepted-pressure-law",
    valid: true,
    meaning: {
      kind: "quantity",
      expression: ["Equal", "P", ["Divide", "F", "A"]],
      symbols: {
        P: { label: "pressure", unit: "Pa" },
        F: { label: "perpendicular force", unit: "N" },
        A: { label: "area", unit: "m^2" },
      },
      conditions: ["flat face", "perpendicular force"],
    },
    fieldBasis: {
      expression: basis("e0"),
      symbols: basis("e1"),
      conditions: basis("e1"),
    },
  };
  const reading = (corrected) => ({
    id: "accepted-reading",
    valid: true,
    meaning: {
      kind: "quantity",
      expression: ["Equal", "Q", corrected ? 95 : 90],
      symbols: { Q: { label: "sealed vessel pressure reading", unit: "kPa" } },
      conditions: [],
    },
    fieldBasis: {
      expression: basis(corrected ? "e3" : "e2"),
      symbols: basis("e2"),
    },
  });
  const manifest = {
    identity: "test-only-natural-manifest",
    paid_enabled: false,
    lesson_sha256: sha256(lesson),
  };
  const evidence = lesson.transcript_events.map((e, i) => ({
    id: "persisted-" + e.event_id,
    text: e.text,
    sequence: i + 1,
  }));
  const cursor = {
    evidenceId: evidence.at(-1).id,
    sequence: evidence.length,
    offset: evidence.at(-1).text.length,
  };
  const result = {
    identity: "cuelayer-v2-natural-short-results-1",
    manifest_sha256: sha256(manifest),
    lesson_sha256: sha256(lesson),
    status: "ADJUDICATION_REQUIRED",
    dependency_mode: "STUB",
    failures: [],
    admissions: lesson.transcript_events.map((e) => ({
      event_id: e.event_id,
      evidence_ids: ["persisted-" + e.event_id],
    })),
    checkpoints: [
      ...lesson.checkpoints,
      { id: "pre_reload" },
      { id: "post_reload" },
    ].map((c) => ({
      id: c.id,
      at_ms: c.at_ms ?? lesson.duration_ms,
      snapshot: {
        replay: {
          state: {
            units: {
              "accepted-pressure-law": clone(pressure),
              "accepted-reading": reading(c.id !== "initial-reading"),
            },
          },
          evidence: clone(evidence),
          recorded: cursor,
          accounted: cursor,
          consumed: evidence.length,
          unresolved: {},
          reviewConcerns: {},
          reviewed: [],
        },
        events: [],
        dom_text: "explicit synthetic plumbing fixture",
        cue: null,
        trace: [],
      },
    })),
    requests: [],
    attempts: [],
    mechanical_checks: NATURAL_REQUIRED_MECHANICAL.map((id) => ({
      id,
      status: "PASS",
    })),
  };
  result.checkpoints.push({
    id: "empty",
    at_ms: 0,
    snapshot: {
      events: [],
      replay: {
        state: {
          revision: 0,
          cores: {},
          units: {},
          currentCoreId: null,
          mainlineVersion: 0,
          cue: null,
          cueVersion: 0,
        },
        evidence: [],
        consumed: {},
        unresolved: {},
        reviewed: [],
        acceptedTaskIds: [],
        sequence: 0,
        ended: false,
        recorded: { evidenceId: null, sequence: 0, offset: 0 },
        accounted: { evidenceId: null, sequence: 0, offset: 0 },
        generation: 0,
        captureClosed: false,
        inspections: {},
        attempts: {},
        inspectionContexts: {},
        eventVersion: null,
        reviewConcerns: {},
        reviewInspections: {},
      },
    },
  });
  const bindings = {
    "pressure-law": "accepted-pressure-law",
    "reading-initial": "accepted-reading",
    "reading-corrected": "accepted-reading",
    "reading-returned": "accepted-reading",
  };
  return { manifest, lesson, result, bindings };
}
function submission(f, overrides = {}) {
  const packet = exportNaturalReview(f);
  return {
    ...packet.submission_template,
    adjudicator: "offline protocol test; no model quality claim",
    decisions: lesson.oracle.criteria.map((c) => ({
      id: c.id,
      verdict: "PASS",
      reason:
        "Explicit manual verdict supplied only to exercise review protocol plumbing.",
      evidence_refs: c.evidence_refs,
      output_paths: ["/checkpoints"],
    })),
    bindings: f.bindings,
    ...overrides,
  };
}

test("independent lesson preserves exact source order, bounded checkpoints and required semantic coverage", () => {
  assert.equal(lesson.transcript_events.length, 9);
  assert.equal(lesson.transcript_events[1].at_ms, 900);
  assert.equal(
    lesson.transcript_events[3].at_ms - lesson.transcript_events[2].at_ms,
    20000,
  );
  assert.equal(lesson.duration_ms, 97000);
  assert.deepEqual(
    lesson.oracle.criteria.map((c) => c.id),
    [
      "pressure-relationship",
      "initial-reading",
      "reading-correction",
      "teacher-invitation",
      "unfinished-survives-administration",
      "actual-membrane-clarification",
      "topic-return",
      "all-accepted-meaning",
      "source-no-loss",
      "reload-and-surface",
    ],
  );
  for (const mutate of [
    (l) => {
      l.transcript_events[1].event_id = "e0";
    },
    (l) => {
      l.transcript_events[1].at_ms = 0;
    },
    (l) => {
      l.checkpoints[0].at_ms = 98000;
    },
    (l) => {
      l.oracle.criteria[0].evidence_refs = ["absent"];
    },
    (l) => {
      l.oracle.bindings[0].field_grounding[0].evidence_any = ["absent"];
    },
    (l) => {
      l.oracle.same_identity = [["reading-initial", "nonexistent"]];
    },
  ]) {
    const invalid = clone(lesson);
    mutate(invalid);
    assert.throws(() => validateNaturalLesson(invalid), /natural-lesson/);
  }
});

test("schema-shaped accepted quantities and mechanical checks cannot create semantic PASS without review", () => {
  const f = fixture();
  f.result.mechanical_checks.push({ id: "schema", status: "PASS" });
  const report = importNaturalReview(f);
  assert.equal(report.semantic_status, "PENDING");
  assert.equal(report.full_cohorts_blocked, true);
  assert(report.criteria.every((c) => c.status === "PENDING"));
  assert(report.provenance.every((c) => c.status === "PENDING"));
});

test("a complete explicit review can clear semantics without changing raw results or claiming operational success", () => {
  const f = fixture(),
    raw = sha256(f.result);
  const report = importNaturalReview({ ...f, submission: submission(f) });
  assert.equal(report.semantic_status, "PASS");
  assert.equal(report.full_cohorts_blocked, true);
  assert(report.scope.includes("does not waive execution"));
  assert.equal(f.result.status, "ADJUDICATION_REQUIRED");
  assert.equal(sha256(f.result), raw);
  assert.equal(report.provenance.length, 9);
});

test("known unsupported units and answer leakage remain failures through explicit semantic adjudication", () => {
  const f = fixture();
  f.result.checkpoints[0].snapshot.replay.state.units[
    "accepted-reading"
  ].meaning.symbols.Q.unit = "bar";
  f.result.checkpoints[2].snapshot.dom_text =
    "The corrected reading is higher.";
  const review = submission(f);
  for (const [id, reason, path] of [
    [
      "initial-reading",
      "The source states kPa but the accepted reading incorrectly assigns bar.",
      "/checkpoints/0/snapshot/replay/state/units/accepted-reading/meaning/symbols/Q/unit",
    ],
    [
      "teacher-invitation",
      "The surface reveals the higher/lower answer in place of the partner invitation.",
      "/checkpoints/2/snapshot/dom_text",
    ],
  ])
    Object.assign(
      review.decisions.find((d) => d.id === id),
      { verdict: "FAIL", reason, output_paths: [path] },
    );
  const report = importNaturalReview({ ...f, submission: review });
  assert.equal(report.semantic_status, "FAIL");
  assert.equal(report.full_cohorts_blocked, true);
});

test("exact manifest, source and result identity changes invalidate an earlier review", () => {
  for (const mutate of [
    (f) => {
      f.result.checkpoints[0].snapshot.dom_text = "changed";
    },
    (f) => {
      f.manifest.changed = true;
      f.result.manifest_sha256 = sha256(f.manifest);
    },
    (f) => {
      f.lesson.transcript_events[0].text += " changed";
      f.manifest.lesson_sha256 = sha256(f.lesson);
      f.result.lesson_sha256 = sha256(f.lesson);
      f.result.manifest_sha256 = sha256(f.manifest);
    },
  ]) {
    const f = clone(fixture()),
      review = submission(f);
    mutate(f);
    assert.throws(
      () => importNaturalReview({ ...f, submission: review }),
      /adjudication-drift/,
    );
  }
});

test("unknown citations, invalid output pointers, duplicate decisions and invented role IDs reject", () => {
  for (const mutate of [
    (s) => {
      s.decisions[0].evidence_refs = ["e8"];
    },
    (s) => {
      s.decisions[0].output_paths = ["/missing"];
    },
    (s) => {
      s.decisions[0].output_paths = ["/toString"];
    },
    (s) => {
      s.decisions.push(s.decisions[0]);
    },
    (s) => {
      s.bindings["reading-initial"] = "invented-unit";
    },
  ]) {
    const f = fixture(),
      review = submission(f);
    mutate(review);
    assert.throws(
      () => importNaturalReview({ ...f, submission: review }),
      /natural-review/,
    );
  }
});

test("missing decision, missing checkpoint or missing role binding stays pending", () => {
  const a = fixture(),
    partial = submission(a);
  partial.decisions.pop();
  assert.equal(
    importNaturalReview({ ...a, submission: partial }).semantic_status,
    "PENDING",
  );
  const b = fixture();
  b.result.checkpoints = b.result.checkpoints.filter(
    (c) => c.id !== "invitation",
  );
  assert.equal(
    importNaturalReview({ ...b, submission: submission(b) }).semantic_status,
    "PENDING",
  );
  const c = fixture(),
    unbound = submission(c);
  delete unbound.bindings["pressure-law"];
  assert.equal(
    importNaturalReview({ ...c, submission: unbound }).semantic_status,
    "PENDING",
  );
});

test("field provenance uses actual admitted IDs and cannot be waived by manual PASS", () => {
  const f = fixture();
  f.result.checkpoints[0].snapshot.replay.state.units[
    "accepted-pressure-law"
  ].fieldBasis.symbols = basis("e0");
  const report = importNaturalReview({ ...f, submission: submission(f) });
  assert.equal(report.semantic_status, "FAIL");
  assert.equal(
    report.provenance.find(
      (c) => c.binding === "pressure-law" && c.field === "symbols",
    ).status,
    "FAIL",
  );
  const g = fixture();
  g.result.admissions[1].evidence_ids = ["wrong-persisted-id"];
  assert.equal(
    importNaturalReview({ ...g, submission: submission(g) }).semantic_status,
    "FAIL",
  );
});

test("separate correction identity and changed reload knowledge fail despite manual PASS", () => {
  const f = fixture();
  const c = f.result.checkpoints.find((c) => c.id === "corrected-reading");
  c.snapshot.replay.state.units["replacement-reading"] = clone(
    c.snapshot.replay.state.units["accepted-reading"],
  );
  c.snapshot.replay.state.units["replacement-reading"].id =
    "replacement-reading";
  f.bindings["reading-corrected"] = "replacement-reading";
  const report = importNaturalReview({ ...f, submission: submission(f) });
  assert.equal(report.semantic_status, "FAIL");
  assert.equal(
    report.identities.find((c) => c.rule === "same_identity").status,
    "FAIL",
  );
  const g = fixture();
  g.result.checkpoints.find(
    (c) => c.id === "post_reload",
  ).snapshot.replay.state.units["accepted-reading"].meaning.expression[2] = 90;
  const reload = importNaturalReview({ ...g, submission: submission(g) });
  assert.equal(reload.semantic_status, "FAIL");
  assert.deepEqual(reload.reload.differences, ["state"]);
});

test("larger cohorts require LIVE and every explicit mechanical check in addition to semantics", () => {
  const valid = fixture();
  valid.result.dependency_mode = "LIVE";
  assert.equal(
    importNaturalReview({ ...valid, submission: submission(valid) })
      .full_cohorts_blocked,
    false,
  );
  for (const mutate of [
    (r) => {
      r.dependency_mode = "STUB";
    },
    (r) => {
      delete r.dependency_mode;
    },
    (r) => {
      r.mechanical_checks = [];
    },
    (r) => {
      r.mechanical_checks.pop();
    },
    (r) => {
      r.mechanical_checks[0].status = "FAIL";
    },
    (r) => {
      r.mechanical_checks.push(r.mechanical_checks[0]);
    },
    (r) => {
      r.failures.push({ reason: "driver-failure" });
    },
    (r) => {
      delete r.failures;
    },
  ]) {
    const f = clone(valid);
    mutate(f.result);
    const report = importNaturalReview({ ...f, submission: submission(f) });
    assert.equal(report.semantic_status, "PASS");
    assert.equal(report.full_cohorts_blocked, true);
  }
});

test("the empty checkpoint is required and seeded authority cannot be waived by a review", () => {
  const missing = fixture();
  missing.result.checkpoints = missing.result.checkpoints.filter(
    (c) => c.id !== "empty",
  );
  const pending = importNaturalReview({
    ...missing,
    submission: submission(missing),
  });
  assert.equal(pending.semantic_status, "PENDING");
  assert.equal(pending.full_cohorts_blocked, true);
  for (const mutate of [
    (s) => {
      s.events.push({ type: "accepted" });
    },
    (s) => {
      s.replay.state.units.seed = { meaning: "seeded knowledge" };
    },
    (s) => {
      s.replay.evidence.push({ text: "seeded source" });
    },
    (s) => {
      s.replay.reviewConcerns.seed = { range: {} };
    },
    (s) => {
      delete s.replay.accounted;
    },
  ]) {
    const f = fixture();
    mutate(f.result.checkpoints.find((c) => c.id === "empty").snapshot);
    const report = importNaturalReview({ ...f, submission: submission(f) });
    assert.equal(report.semantic_status, "FAIL");
    assert.equal(report.full_cohorts_blocked, true);
  }
});
