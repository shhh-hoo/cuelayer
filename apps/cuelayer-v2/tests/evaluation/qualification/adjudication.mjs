import { sha256 } from "../evidence.mjs";

const metrics = [
  "disposition",
  "reference_resolution",
  "knowledge_mutation",
  "provenance",
  "end_state",
  "false_terminal_no_change",
];
const same = (a, b) => sha256(a) === sha256(b);
const combine = (values) =>
  values.includes("FAIL")
    ? "FAIL"
    : values.includes("UNRESOLVED")
      ? "PENDING"
      : "PASS";
function manualChecks(specification) {
  const o = specification.oracle,
    all = specification.evidence.map((e) => e.event_id);
  return [
    ...["required", "forbidden"].flatMap((kind) =>
      o[kind].map((c) => ({
        id: kind + ":" + c.id,
        metric: "knowledge_mutation",
        claim: c.claim,
        evidence_refs: c.evidence_refs,
      })),
    ),
    ...o.identity_rules.map((claim, i) => ({
      id: "identity:" + i,
      metric: "end_state",
      claim,
      evidence_refs: all,
    })),
    {
      id: "all-mutations",
      metric: "knowledge_mutation",
      claim:
        "Every new or changed assertion preserves the source authority, subjects, polarity, direction, quantity, units and scope. No unsupported assertion or answer leak is added.",
      evidence_refs: all,
    },
    {
      id: "end-state",
      metric: "end_state",
      claim:
        "The resulting accepted state, unresolved work and processing cursor satisfy every frozen required/forbidden claim and identity rule for this case.",
      evidence_refs: all,
    },
    ...(o.applicable_metrics.includes("false_terminal_no_change")
      ? [
          {
            id: "false-terminal",
            metric: "false_terminal_no_change",
            claim:
              "Every source slice closed as NO_CHANGE or CONFIRMED_NO_CHANGE is terminally nonsemantic; no unfinished assertion, unresolved reference, quantity field or forward promise loses recoverable work.",
            evidence_refs: all,
          },
        ]
      : []),
    ...(o.applicable_metrics.includes("reference_resolution")
      ? [
          {
            id: "reference-binding",
            metric: "reference_resolution",
            claim:
              "All selected references and relation endpoints are explicitly justified by the captured evidence. Ambiguous references remain unresolved and no disconnected target piggybacks on a valid binding.",
            evidence_refs: all,
          },
        ]
      : []),
  ];
}
export function actualDisposition(row) {
  const p = row.parser?.value;
  if (!row.parser?.success || !p) return null;
  if (p.results) return p.results.length === 1 ? p.results[0].outcome : null;
  if (p.groups?.some((g) => g.outcome === "APPLY")) return "APPLY";
  if (p.groups?.some((g) => g.outcome === "CARRY")) return "CARRY";
  if (p.suffixStatus === "WAIT_MORE_INPUT") return "WAIT";
  return p.groups?.length && p.groups.every((g) => g.outcome === "NO_CHANGE")
    ? "NO_CHANGE"
    : null;
}
export function fieldProvenanceScore(
  specification,
  snapshot,
  row,
  bindings = {},
) {
  if (!specification.oracle.field_grounding.length)
    return { status: "NOT_APPLICABLE", checks: [] };
  if (!row.attempts?.some((a) => a.host_accepted))
    return { status: "UNAVAILABLE", checks: [], reason: "no-accepted-result" };
  const checks = specification.oracle.field_grounding.map((rule) => {
    const id = snapshot.unit_keys[rule.unit_key] ?? bindings[rule.unit_key],
      unit = row.poststate?.state?.units?.[id];
    if (!id)
      return {
        unit_key: rule.unit_key,
        field: rule.field,
        status: "PENDING",
        reason: "semantic-role-binding-required",
      };
    const basis = unit?.fieldBasis?.[rule.field],
      refs = new Set(basis?.map((b) => b.evidenceId) ?? []);
    return {
      unit_key: rule.unit_key,
      unit_id: id,
      field: rule.field,
      status:
        Array.isArray(basis) &&
        rule.required_evidence.every((e) => refs.has(e)) &&
        rule.forbidden_evidence.every((e) => !refs.has(e))
          ? "PASS"
          : "FAIL",
      actual_evidence: [...refs],
      required_evidence: rule.required_evidence,
      forbidden_evidence: rule.forbidden_evidence,
    };
  });
  return {
    status: checks.some((c) => c.status === "FAIL")
      ? "FAIL"
      : checks.some((c) => c.status === "PENDING")
        ? "PENDING"
        : "PASS",
    checks,
  };
}
function resolvePointer(value, pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("/")) return undefined;
  return pointer
    .slice(1)
    .split("/")
    .reduce(
      (v, k) => v?.[k.replaceAll("~1", "/").replaceAll("~0", "~")],
      value,
    );
}
export function exportReviewPacket(verified, rows) {
  const cases = verified.corpus.pairs.flatMap((p) => p.cases);
  return {
    identity: "cuelayer-v2-semantic-review-packet-1",
    manifest_sha256: sha256(verified.manifest),
    oracle_sha256: verified.manifest.corpus.oracle_sha256,
    rubric: verified.corpus.oracle_policy,
    trials: rows
      .filter((r) => r.parser?.success)
      .map((row) => {
        const trial = verified.manifest.trials.find(
          (t) => t.trial_id === row.trial_id,
        );
        if (!trial) throw Error("review-unknown-trial");
        const specification = cases.find(
            (c) => c.case_id === trial.snapshot_id,
          ),
          snapshot = verified.snapshots.find(
            (s) => s.snapshot_id === trial.snapshot_id,
          );
        return {
          trial_id: trial.trial_id,
          case_id: trial.snapshot_id,
          candidate_id: trial.candidate_id,
          response_sha256: sha256(row),
          specification,
          task: snapshot.task,
          request: snapshot.request,
          prestate: snapshot.prestate,
          unit_keys: snapshot.unit_keys,
          row,
          required_decisions: manualChecks(specification),
          binding_keys: [
            ...new Set(
              specification.oracle.field_grounding
                .map((f) => f.unit_key)
                .filter((k) => k.startsWith("new-")),
            ),
          ],
        };
      }),
  };
}
export function importAdjudication(verified, rows, submission) {
  if (
    submission.identity !== "cuelayer-v2-semantic-adjudication-1" ||
    submission.manifest_sha256 !== sha256(verified.manifest) ||
    submission.oracle_sha256 !== verified.manifest.corpus.oracle_sha256 ||
    typeof submission.adjudicator !== "string" ||
    !submission.adjudicator.trim()
  )
    throw Error("adjudication-identity-mismatch");
  const packet = exportReviewPacket(verified, rows),
    reviews = new Map();
  for (const review of submission.reviews ?? []) {
    const entry = packet.trials.find((t) => t.trial_id === review.trial_id);
    if (
      !entry ||
      reviews.has(review.trial_id) ||
      review.response_sha256 !== entry.response_sha256
    )
      throw Error("adjudication-response-drift-or-duplicate");
    if (
      !Array.isArray(review.decisions) ||
      !same(
        review.decisions.map((d) => d.id).sort(),
        entry.required_decisions.map((d) => d.id).sort(),
      )
    )
      throw Error("adjudication-decision-coverage");
    for (const d of review.decisions) {
      const check = entry.required_decisions.find((c) => c.id === d.id);
      if (
        !["PASS", "FAIL", "UNRESOLVED"].includes(d.verdict) ||
        typeof d.reason !== "string" ||
        !d.reason.trim() ||
        !Array.isArray(d.evidence_refs) ||
        !d.evidence_refs.length ||
        d.evidence_refs.some((id) => !check.evidence_refs.includes(id)) ||
        !Array.isArray(d.output_paths) ||
        !d.output_paths.length ||
        d.output_paths.some(
          (path) => resolvePointer(entry.row, path) === undefined,
        )
      )
        throw Error("adjudication-unsupported-decision");
    }
    const bindings = review.bindings ?? {};
    if (
      Object.keys(bindings).some((k) => !entry.binding_keys.includes(k)) ||
      Object.values(bindings).some(
        (id) => !entry.row.poststate?.state?.units?.[id],
      )
    )
      throw Error("adjudication-invalid-binding");
    reviews.set(review.trial_id, review);
  }
  return rows.map((row) => {
    const trial = verified.manifest.trials.find(
        (t) => t.trial_id === row.trial_id,
      ),
      specification = verified.corpus.pairs
        .flatMap((p) => p.cases)
        .find((c) => c.case_id === trial?.snapshot_id);
    if (!specification) throw Error("adjudication-unknown-result");
    const scores = Object.fromEntries(
      metrics.map((m) => [
        m,
        specification.oracle.applicable_metrics.includes(m)
          ? "PENDING"
          : "NOT_APPLICABLE",
      ]),
    );
    if (!row.parser?.success) {
      for (const m of metrics)
        if (scores[m] !== "NOT_APPLICABLE") scores[m] = "UNAVAILABLE";
      return {
        ...row,
        semantic_review_status: "VALIDATED",
        semantic_scores: scores,
      };
    }
    const disposition = actualDisposition(row);
    scores.disposition =
      disposition === null
        ? "PENDING"
        : specification.oracle.allowed_dispositions.includes(disposition)
          ? "PASS"
          : "FAIL";
    if (scores.false_terminal_no_change !== "NOT_APPLICABLE")
      scores.false_terminal_no_change =
        disposition === null
          ? "PENDING"
          : ["NO_CHANGE", "CONFIRMED_NO_CHANGE"].includes(disposition) &&
              !specification.oracle.allowed_dispositions.includes(disposition)
            ? "FAIL"
            : "PASS";
    const mixedTerminal =
      row.parser.value.groups?.some((g) => g.outcome === "NO_CHANGE") &&
      row.parser.value.groups?.some((g) => g.outcome !== "NO_CHANGE");
    if (mixedTerminal && scores.false_terminal_no_change === "PASS")
      scores.false_terminal_no_change = "PENDING";
    const review = reviews.get(row.trial_id),
      snapshot = verified.snapshots.find(
        (s) => s.snapshot_id === trial.snapshot_id,
      );
    const provenance = fieldProvenanceScore(
      specification,
      snapshot,
      row,
      review?.bindings,
    );
    scores.provenance = provenance.status;
    if (review)
      for (const metric of [
        "knowledge_mutation",
        "end_state",
        "reference_resolution",
        "false_terminal_no_change",
      ]) {
        const checks = manualChecks(specification).filter(
          (c) => c.metric === metric,
        );
        if (checks.length && scores[metric] !== "FAIL")
          scores[metric] = combine(
            checks.map(
              (c) => review.decisions.find((d) => d.id === c.id).verdict,
            ),
          );
      }
    return {
      ...row,
      semantic_review_status: "VALIDATED",
      semantic_scores: scores,
      semantic_provenance_checks: provenance.checks,
      adjudication: review
        ? {
            adjudicator: submission.adjudicator,
            decisions: review.decisions,
            bindings: review.bindings ?? {},
          }
        : null,
    };
  });
}
