// Versioned proposition oracle only. Existing five canary predicates are untouched.
const norm = (x) =>
  String(x ?? "")
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
const fail = (reason) => ({ status: "FAIL", reason });
const review = (reason) => ({
  status: null,
  reason,
  adjudication_status: "ADJUDICATION_REQUIRED",
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function stagePropositionV2(local, rule) {
  const pre = local.stage_prestate;
  if (!pre)
    return { status: "NOT_EXERCISED", reason: "stage-prestate-not-observed" };
  const units = local.model_units ?? [];
  const anchors = Object.values(pre.state.units).filter(
    (u) =>
      norm(u.meaning.text) === norm(rule.anchor_claim) &&
      u.basis.some((b) => b.evidenceId === rule.anchor_source),
  );
  if (anchors.length !== 1) return fail("stage-anchor-not-unique");
  const anchor = anchors[0];
  const candidates = units.filter(
    (u) => u.id !== anchor.id && rule.legal_kinds.includes(u.meaning.kind),
  );
  if (candidates.length !== 1)
    return fail("stage-proposition-not-unique-or-missing");
  const unit = candidates[0],
    text = norm(unit.meaning.text);
  const claim = new RegExp(rule.claim_pattern, "u"),
    reversed = new RegExp(rule.reversed_pattern, "u");
  if (reversed.test(text)) return fail("stage-proposition-reversed-endpoints");
  if (!claim.test(text)) {
    // A recognized complete claim plus extra assertions is not an equivalent claim.
    const prefix = new RegExp(rule.claim_pattern.slice(0, -1), "u");
    if (prefix.test(text) || text.includes(" does not determine "))
      return fail("stage-unsupported-assertion");
    return review("stage-proposition-entailment-v2");
  }
  for (const id of rule.required_sources) {
    const source = pre.evidence.find((e) => e.id === id);
    const pieces = (unit.basis ?? []).filter((b) => b.evidenceId === id);
    if (
      !source ||
      !pieces.length ||
      !pieces.every((b) => b.quote && source.text.includes(b.quote))
    )
      return fail("stage-missing-provenance");
  }
  const continuing = units.find((u) => u.id === anchor.id);
  const targets = [
    unit.meaning.target,
    ...(unit.requires ?? []),
    ...(unit.links ?? []).map((d) => d.target),
    ...(unit.declaredDependencies ?? []).map((d) => d.target),
  ];
  if (
    !continuing ||
    !same(continuing.meaning, anchor.meaning) ||
    continuing.version !== anchor.version ||
    !targets.includes(anchor.id)
  )
    return fail("stage-identity-or-role-binding-lost");
  if (!local.outcomes?.every((x) => x === "RESOLVED"))
    return fail("stage-obligation-unresolved");
  const accepted = local.reference?.accepted;
  if (!accepted) return review("stage-resolution-contract-unavailable");
  const obligations = local.stage_task.review.items.filter(
    (i) => i.kind === "OBLIGATION",
  );
  if (
    !obligations.length ||
    obligations.some(
      (i) =>
        !accepted.resolutions.some(
          (r) =>
            r.obligation === i.subjectId &&
            r.targets.includes(unit.id) &&
            rule.required_sources.every((id) =>
              r.basis.some((b) => b.evidenceId === id),
            ),
        ),
    )
  )
    return fail("stage-obligation-unresolved");
  const expected = local.host.expected_state;
  if (
    obligations.some((i) => expected.unresolved[i.subjectId]) ||
    !same(pre.accounted, expected.accounted)
  )
    return fail("stage-resolution-or-accounting");
  return {
    status: "PASS",
    reason: "grounded-proposition-identity-and-resolution-v2",
  };
}
