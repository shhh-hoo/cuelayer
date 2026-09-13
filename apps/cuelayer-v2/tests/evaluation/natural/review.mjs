import { isDeepStrictEqual } from "node:util";
import { sha256 } from "../evidence.mjs";
import { validateNaturalLesson } from "./lesson.mjs";

const combine = (statuses) =>
  statuses.includes("FAIL")
    ? "FAIL"
    : statuses.some((s) => s !== "PASS")
      ? "PENDING"
      : "PASS";
const hasText = (s) => typeof s === "string" && s.trim().length > 0;
const check = (value, reason) => {
  if (!value) throw Error("natural-review-" + reason);
};
const checkpoint = (result, id) => result.checkpoints.find((c) => c.id === id);

export const NATURAL_REQUIRED_MECHANICAL = Object.freeze([
  "complete-formal-admission",
  "durable-source-integrity",
  "reload-exact-history",
  "event-fold-integrity",
  "checkpoint-coverage",
  "all-source-accounted",
  "input-end-accounted",
  "source-during-inference",
  "no-provider-on-reload",
  "observer-integrity",
  "attempt-evidence",
  "driver-fidelity",
  "execution-policy",
  "browser-arrival-fidelity",
  "empty-baseline",
]);

function validateInputs({ manifest, result, lesson }) {
  validateNaturalLesson(lesson);
  check(
    manifest && typeof manifest === "object" && !Array.isArray(manifest),
    "manifest",
  );
  check(manifest.lesson_sha256 === sha256(lesson), "lesson-drift");
  check(
    result?.identity === "cuelayer-v2-natural-short-results-1",
    "result-identity",
  );
  check(
    result.manifest_sha256 === sha256(manifest) &&
      result.lesson_sha256 === sha256(lesson),
    "result-drift",
  );
  check(Array.isArray(result.checkpoints), "checkpoints");
  const allowed = new Set([
    ...lesson.checkpoints.map((c) => c.id),
    "empty",
    "input_end",
    "pre_reload",
    "post_reload",
  ]);
  check(
    result.checkpoints.every((c) => allowed.has(c?.id)) &&
      new Set(result.checkpoints.map((c) => c.id)).size ===
        result.checkpoints.length,
    "checkpoint-drift-or-duplicate",
  );
}

/** The packet carries the complete retained timeline; it assigns no semantics. */
export function exportNaturalReview({ manifest, result, lesson }) {
  validateInputs({ manifest, result, lesson });
  return {
    identity: "cuelayer-v2-natural-short-review-packet-1",
    manifest_sha256: sha256(manifest),
    result_sha256: sha256(result),
    lesson_sha256: sha256(lesson),
    rubric: lesson.oracle.rubric,
    lesson,
    result,
    required_decisions: lesson.oracle.criteria,
    binding_specs: lesson.oracle.bindings,
    submission_template: {
      identity: "cuelayer-v2-natural-short-adjudication-1",
      manifest_sha256: sha256(manifest),
      result_sha256: sha256(result),
      lesson_sha256: sha256(lesson),
      adjudicator: "",
      decisions: [],
      bindings: {},
    },
  };
}

function resolvePointer(value, pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("/"))
    return { found: false };
  for (const part of pointer.slice(1).split("/")) {
    if (/~(?![01])/.test(part)) return { found: false };
    const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
    if (
      value === null ||
      typeof value !== "object" ||
      !Object.hasOwn(value, key)
    )
      return { found: false };
    value = value[key];
  }
  return { found: true, value };
}

function provenanceChecks(lesson, result, bindings) {
  const admissions = result.admissions ?? [];
  const sourceIds = new Map();
  for (const admission of admissions) {
    if (!Array.isArray(admission?.evidence_ids)) continue;
    if (sourceIds.has(admission.event_id)) {
      sourceIds.set(admission.event_id, null);
    } else {
      sourceIds.set(admission.event_id, admission.evidence_ids);
    }
  }
  return lesson.oracle.bindings.flatMap((b) =>
    b.field_grounding.map((f) => {
      const id = bindings[b.key];
      const unit = checkpoint(result, b.checkpoint_id)?.snapshot?.replay?.state
        ?.units?.[id];
      if (!id)
        return {
          binding: b.key,
          field: f.field,
          status: "PENDING",
          reason: "manual-role-binding-required",
        };
      const basis = unit?.fieldBasis?.[f.field];
      const available = f.evidence_any.filter((e) => sourceIds.get(e)?.length);
      const supportedIds = new Set(available.flatMap((e) => sourceIds.get(e)));
      const actual = Array.isArray(basis) ? basis.map((x) => x.evidenceId) : [];
      return {
        binding: b.key,
        unit_id: id,
        checkpoint_id: b.checkpoint_id,
        field: f.field,
        status:
          unit?.meaning?.kind === b.meaning_kind &&
          unit.valid === true &&
          Array.isArray(basis) &&
          actual.some((e) => supportedIds.has(e))
            ? "PASS"
            : "FAIL",
        actual_evidence_ids: actual,
        allowed_source_events: f.evidence_any,
        mapped_evidence_ids: [...supportedIds],
        scope:
          "Field citation membership only; semantic role and span support require the human decisions.",
      };
    }),
  );
}

function identityChecks(lesson, bindings) {
  return ["same_identity", "distinct_identity"].flatMap((rule) =>
    lesson.oracle[rule].map((keys) => {
      const ids = keys.map((key) => bindings[key]);
      return {
        rule,
        bindings: keys,
        unit_ids: ids.map((id) => id ?? null),
        status: ids.some((id) => !id)
          ? "PENDING"
          : (
                rule === "same_identity"
                  ? new Set(ids).size === 1
                  : new Set(ids).size === ids.length
              )
            ? "PASS"
            : "FAIL",
      };
    }),
  );
}

function reloadCheck(result) {
  const before = checkpoint(result, "pre_reload")?.snapshot?.replay;
  const after = checkpoint(result, "post_reload")?.snapshot?.replay;
  if (!before || !after)
    return { status: "PENDING", reason: "reload-snapshots-required" };
  // These are replayed authority fields, not disposable attention or geometry.
  const fields = [
    "state",
    "evidence",
    "recorded",
    "accounted",
    "consumed",
    "unresolved",
    "reviewConcerns",
    "reviewed",
  ];
  const differences = fields.filter(
    (key) => !isDeepStrictEqual(before[key], after[key]),
  );
  const required = ["state", "evidence", "recorded", "accounted", "unresolved"];
  const missing = required.filter(
    (key) => before[key] === undefined || after[key] === undefined,
  );
  return {
    status: differences.length || missing.length ? "FAIL" : "PASS",
    differences,
    missing,
    scope:
      "Replay equality only; learner-surface fidelity and no provider calls remain required review/driver checks.",
  };
}

function emptyCheck(result) {
  const snapshot = checkpoint(result, "empty")?.snapshot;
  if (!snapshot)
    return { status: "PENDING", reason: "empty-baseline-required" };
  const r = snapshot.replay;
  const empty = (v) =>
    v && typeof v === "object" && Object.keys(v).length === 0;
  const noHistory =
    r &&
    [
      "evidence",
      "consumed",
      "unresolved",
      "reviewed",
      "acceptedTaskIds",
      "inspections",
      "attempts",
      "inspectionContexts",
      "reviewConcerns",
      "reviewInspections",
    ].every((key) => empty(r[key]));
  const origin = (c) =>
    c?.sequence === 0 && c.offset === 0 && c.evidenceId === null;
  const valid =
    Array.isArray(snapshot.events) &&
    snapshot.events.length === 0 &&
    noHistory &&
    Array.isArray(r.evidence) &&
    empty(r.state?.units) &&
    empty(r.state?.cores) &&
    r.state.revision === 0 &&
    r.state.mainlineVersion === 0 &&
    r.state.cueVersion === 0 &&
    r.state.currentCoreId === null &&
    r.state.cue === null &&
    r.sequence === 0 &&
    r.generation === 0 &&
    r.ended === false &&
    r.captureClosed === false &&
    r.eventVersion === null &&
    origin(r.recorded) &&
    origin(r.accounted);
  return {
    status: valid ? "PASS" : "FAIL",
    reason: valid
      ? "empty-authoritative-baseline"
      : "baseline-contains-state-or-missing-authority",
  };
}

function executionCheck(result) {
  const checks = Array.isArray(result.mechanical_checks)
    ? result.mechanical_checks
    : [];
  const ids = checks.map((c) => c?.id);
  const missing = NATURAL_REQUIRED_MECHANICAL.filter((id) => !ids.includes(id));
  const nonpassing = checks
    .filter((c) => c?.status !== "PASS")
    .map((c) => c?.id ?? null);
  const valid =
    result.dependency_mode === "LIVE" &&
    Array.isArray(result.failures) &&
    result.failures.length === 0 &&
    !missing.length &&
    !nonpassing.length &&
    new Set(ids).size === ids.length;
  return {
    status: valid ? "PASS" : "BLOCKED",
    dependency_mode: result.dependency_mode ?? null,
    missing_checks: missing,
    nonpassing_checks: nonpassing,
    reason: valid
      ? "live-execution-checks-complete"
      : "live-execution-and-all-mechanical-checks-required",
  };
}

/** Returns a new hash-bound report. Missing reviews never become semantic PASS;
 * deterministic citation/identity/reload failures cannot be waived by a verdict.
 * A larger cohort also requires a LIVE run and every execution/integrity check.
 */
export function importNaturalReview({
  manifest,
  result,
  lesson,
  submission = null,
}) {
  const packet = exportNaturalReview({ manifest, result, lesson });
  const decisions = new Map();
  const bindings = submission?.bindings ?? {};
  if (submission !== null) {
    check(
      submission.identity === "cuelayer-v2-natural-short-adjudication-1" &&
        submission.manifest_sha256 === packet.manifest_sha256 &&
        submission.result_sha256 === packet.result_sha256 &&
        submission.lesson_sha256 === packet.lesson_sha256 &&
        hasText(submission.adjudicator),
      "adjudication-drift",
    );
    check(Array.isArray(submission.decisions), "decisions");
    for (const d of submission.decisions) {
      const criterion = lesson.oracle.criteria.find((c) => c.id === d?.id);
      check(criterion && !decisions.has(d.id), "unknown-or-duplicate-decision");
      check(
        ["PASS", "FAIL", "UNRESOLVED"].includes(d.verdict) && hasText(d.reason),
        "decision",
      );
      check(
        Array.isArray(d.evidence_refs) &&
          d.evidence_refs.length > 0 &&
          d.evidence_refs.every((id) => criterion.evidence_refs.includes(id)),
        "decision-evidence",
      );
      check(
        Array.isArray(d.output_paths) &&
          d.output_paths.length > 0 &&
          d.output_paths.every((p) => resolvePointer(result, p).found),
        "decision-pointer",
      );
      decisions.set(d.id, structuredClone(d));
    }
    check(
      bindings && typeof bindings === "object" && !Array.isArray(bindings),
      "bindings",
    );
    for (const [key, id] of Object.entries(bindings)) {
      const b = lesson.oracle.bindings.find((s) => s.key === key);
      check(
        b &&
          hasText(id) &&
          Object.hasOwn(
            checkpoint(result, b.checkpoint_id)?.snapshot?.replay?.state
              ?.units ?? {},
            id,
          ),
        "invalid-role-binding",
      );
    }
  }
  const reviewed = lesson.oracle.criteria.map((c) => {
    const d = decisions.get(c.id);
    const missing = c.checkpoint_ids.filter((id) => !checkpoint(result, id));
    return {
      id: c.id,
      status:
        d?.verdict === "FAIL"
          ? "FAIL"
          : !d || d.verdict === "UNRESOLVED" || missing.length
            ? "PENDING"
            : "PASS",
      decision: d ?? null,
      missing_checkpoints: missing,
    };
  });
  const provenance = provenanceChecks(lesson, result, bindings);
  const identities = identityChecks(lesson, bindings);
  const reload = reloadCheck(result);
  const baseline = emptyCheck(result);
  const execution = executionCheck(result);
  const semantic_status = combine(
    [...reviewed, ...provenance, ...identities, reload, baseline].map(
      (c) => c.status,
    ),
  );
  return {
    identity: "cuelayer-v2-natural-short-semantic-review-1",
    manifest_sha256: packet.manifest_sha256,
    result_sha256: packet.result_sha256,
    lesson_sha256: packet.lesson_sha256,
    adjudication_sha256: submission ? sha256(submission) : null,
    adjudicator: submission?.adjudicator ?? null,
    semantic_status,
    full_cohorts_blocked:
      semantic_status !== "PASS" || execution.status !== "PASS",
    scope:
      "Semantic PASS does not waive execution: full_cohorts_blocked also requires LIVE and every mechanical check. Prior qualification failures remain retained; this short gate does not establish sustained capacity.",
    criteria: reviewed,
    provenance,
    identities,
    reload,
    baseline,
    execution,
    bindings: structuredClone(bindings),
  };
}
