import { stagePropositionV2 } from "./stage-oracle-v2.mjs";
import {
  expectations,
  validateScenario,
  layers,
  hardSemanticReasons,
} from "./contract.mjs";
import { readiness, classifyFault } from "./evidence.mjs";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normalize = (s) =>
  String(s ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!]$/, "")
    .toLowerCase();
const out = (status, reason, extra = {}) => ({ status, reason, ...extra });
const pass = () => out("PASS", "satisfied");
const fail = (reason) => out("FAIL", reason);
const absent = (reason) => out("NOT_EXERCISED", reason);
const review = (reason) =>
  out(null, reason, { adjudication_status: "ADJUDICATION_REQUIRED" });
function contains(actual, wanted) {
  if (Array.isArray(wanted))
    return (
      Array.isArray(actual) &&
      wanted.every((w) => actual.some((a) => contains(a, w)))
    );
  if (wanted && typeof wanted === "object")
    return (
      actual && Object.entries(wanted).every(([k, v]) => contains(actual[k], v))
    );
  return actual === wanted;
}
export function selectUnits(units, selector = {}) {
  return units.filter(
    (u) =>
      (!selector.kind || u.meaning.kind === selector.kind) &&
      (!selector.source_any?.length ||
        selector.source_any.some((id) =>
          (u.evidence_refs ?? u.basis?.map((b) => b.evidenceId) ?? []).includes(
            id,
          ),
        )),
  );
}
export function meaningMatch(unit, p) {
  const m = unit.meaning;
  if (p.scalar) {
    if (m.kind !== "quantity")
      return review("unrecognized-quantity-representation");
    const e = m.expression;
    if (!Array.isArray(e) || e[0] !== "Equal")
      return review("unsupported-expression-domain");
    const number = e.find((x) => typeof x === "number"),
      symbol = e.find((x, i) => i > 0 && typeof x === "string");
    const actualUnit = m.symbols?.[symbol]?.unit;
    const role = normalize(m.symbols?.[symbol]?.label);
    if (p.scalar.forbidden_role_labels?.some((x) => normalize(x) === role))
      return fail("false-quantity-role");
    if (
      p.scalar.role_labels &&
      !p.scalar.role_labels.some((x) => normalize(x) === role)
    )
      return review("quantity-role-equivalence");
    const scales = {
      Pa: 1,
      kPa: 1000,
      MPa: 1000000,
      m: 1,
      cm: 0.01,
      "m²": 1,
      "cm²": 0.0001,
      dimensionless: 1,
    };
    const dimensions = {
      Pa: "pressure",
      kPa: "pressure",
      MPa: "pressure",
      m: "length",
      cm: "length",
      "m²": "area",
      "cm²": "area",
      dimensionless: "ratio",
    };
    if (!Number.isFinite(number) || !actualUnit)
      return fail("missing-number-or-unit");
    if (
      actualUnit !== p.scalar.unit &&
      (!dimensions[actualUnit] ||
        dimensions[actualUnit] !== dimensions[p.scalar.unit])
    )
      return fail("wrong-physical-unit");
    if (
      Math.abs(
        number * (scales[actualUnit] ?? 1) -
          p.scalar.value * (scales[p.scalar.unit] ?? 1),
      ) > 1e-8
    )
      return fail("false-numeric-value");
  }
  if (p.product_equation) {
    if (m.kind !== "quantity" || !Array.isArray(m.expression))
      return review("unrecognized-equation");
    const [op, a, b] = m.expression;
    const product = [a, b].find((x) => Array.isArray(x) && x[0] === "Multiply");
    const target = [a, b].find((x) => typeof x === "string");
    if (op !== "Equal" || !product || product.length !== 3 || !target)
      return fail("false-operator-or-arity");
    if (new Set([target, ...product.slice(1)]).size !== 3)
      return fail("operand-binding");
    const actual = [
      m.symbols?.[target]?.unit,
      ...product.slice(1).map((x) => m.symbols?.[x]?.unit),
    ];
    const want = p.product_equation.units;
    if (actual.some((x) => !x)) return fail("missing-units");
    if (
      actual[0] !== want[0] ||
      !same(actual.slice(1).sort(), want.slice(1).sort())
    )
      return fail("wrong-unit-or-variable-role");
  }
  if (p.conditions) {
    if (!m.conditions?.length) return fail("missing-truth-critical-condition");
    if (
      !p.conditions.every((c) =>
        m.conditions.some((actual) => normalize(c) === normalize(actual)),
      )
    )
      return review("condition-equivalence-requires-frozen-rubric");
  }
  if (p.relation) {
    if (m.kind !== "relation" || m.relation !== p.relation.kind)
      return fail("wrong-relation-kind");
    if (!same(unit.endpoint_roles, p.relation.endpoint_roles))
      return fail("relation-endpoints-or-direction");
  }
  if (p.exact_claims) {
    const text = normalize(m.text);
    if ((p.false_claims ?? []).some((t) => normalize(t) === text))
      return fail("false-proposition");
    if (!p.exact_claims.some((t) => normalize(t) === text))
      return review("text-entailment-requires-frozen-rubric");
  }
  return pass();
}
export function predicate(p, ctx) {
  const observations = ctx.observations ?? {},
    local = observations[p.expectation_id] ?? {},
    q = p.parameters;
  switch (p.predicate_id) {
    case "experiment.valid":
      if (ctx.faults?.length) {
        const fs = ctx.faults.map(classifyFault);
        return (
          fs.find((f) => f.status === "FAIL") ??
          fs.find((f) => f.status === "INVALID") ??
          fs[0]
        );
      }
      return ctx.validity_verified
        ? pass()
        : absent("validity-evidence-missing");
    case "transcript.admitted": {
      const events = ctx.scenario.transcript_events.filter((e) =>
        p.evidence_refs.includes(e.event_id),
      );
      const rows = ctx.timeline ?? [];
      for (const event of events) {
        const matches = rows.filter((x) => x.event_id === event.event_id);
        if (matches.length !== 1)
          return fail(
            matches.length ? "duplicate-admission" : "missing-admission",
          );
        const r = matches[0];
        if (r.text !== event.text || !Number.isFinite(r.admitted_at))
          return fail("changed-or-unadmitted-source");
        if (r.admitted_at < r.page_received_at) return fail("admission-order");
      }
      return pass();
    }
    case "request.adequate":
      return local.projection
        ? local.projection.violations.length
          ? fail(local.projection.violations.join(","))
          : pass()
        : absent("request-not-observed");
    case "model.schema":
      return typeof local.schema_valid === "boolean"
        ? local.schema_valid
          ? pass()
          : fail("model-schema-invalid")
        : absent("response-not-observed");
    case "meaning.matches": {
      if (!local.response_complete)
        return absent("model-response-not-observed");
      if (q.proposition_v2) return stagePropositionV2(local, q.proposition_v2);
      if (local.semantic_projection_error)
        return review("semantic-decoding:" + local.semantic_projection_error);
      if (q.expected_outcome)
        return (local.outcomes ?? []).includes(q.expected_outcome)
          ? pass()
          : fail("wrong-semantic-disposition");
      const units = selectUnits(local.model_units ?? [], q.selector);
      if (!units.length) return fail("missing-required-meaning");
      const matches = units.map((u) => meaningMatch(u, q));
      if (matches.filter((r) => r.status === "PASS").length > 1)
        return fail("duplicate-current-meaning");
      if (matches.some((r) => r.status === "PASS"))
        return units.length > 1 ? review("selector-not-unique") : pass();
      return matches.find((r) => r.status === null) ?? matches[0];
    }
    case "meaning.forbidden": {
      if (!local.response_complete)
        return absent("model-response-not-observed");
      const units = selectUnits(
        local.history?.flatMap((r) => r.model_units ?? []) ??
          local.model_units ??
          [],
        q.selector,
      );
      for (const u of units) {
        if (q.any_unit) return fail("forbidden-established-meaning");
        if (
          q.false_claims?.some(
            (t) => normalize(t) === normalize(u.meaning.text),
          )
        )
          return fail("false-proposition");
        if (q.scalar && meaningMatch(u, q).status === "FAIL")
          return fail("false-numeric-value");
      }
      return pass();
    }
    case "cue.matches":
      if (!local.response_complete)
        return absent("model-response-not-observed");
      if (!local.model_cue) return fail("missing-required-cue");
      return meaningMatch(
        { meaning: { kind: "statement", text: local.model_cue.text } },
        q,
      );
    case "state.identity":
      if (!local.identity) return absent("identity-transition-not-observed");
      return local.identity.same_object &&
        local.identity.history_preserved &&
        local.identity.current_count === 1
        ? pass()
        : fail("correction-identity-or-history");
    case "carry.preserved":
      if (!local.carry) return absent("carry-lifecycle-not-observed");
      return local.carry.deleted_without_resolution
        ? fail("carry-deleted-without-proof")
        : pass();
    case "host.contract":
      // Independently generated by frozen validate/fold from the *actual* task and before-state.
      if (!local.host) return absent("host-contract-evidence-missing");
      if (local.host.timestamp_contract_valid === null)
        return review("acceptance-clock-context-missing");
      if (local.host.timestamp_contract_valid === false)
        return fail("acceptance-clock-contract-divergence");
      return local.host.expected_accepted === local.host.actual_accepted &&
        same(local.host.expected_state, local.host.actual_state)
        ? pass()
        : fail("host-executable-contract-divergence");
    case "frontier.progress": {
      const rows = ctx.frontier ?? [];
      if (!rows.length) return absent("frontier-not-observed");
      if (ctx.stall_proven) return fail("unjustified-scheduler-stall");
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i],
          prev = rows[i - 1];
        if (r.A > r.R || r.A < 0 || (prev && (r.A < prev.A || r.R < prev.R)))
          return fail("frontier-integrity");
      }
      const windows = ctx.windows ?? [];
      if (
        windows.some(
          (w) =>
            w.evidence_missing ||
            (w.ratio !== null && w.ratio < q.minimum_ratio),
        )
      )
        return fail("source-progress-below-budget");
      return pass();
    }
    case "checkpoint.due":
    case "latency.semantic":
    case "latency.display":
    case "latency.total": {
      const target =
        expectations(ctx.scenario).find(
          (x) => x.expectation_id === q.checkpoint_id,
        ) ?? p;
      const anchor = readiness(target, ctx.timeline ?? []);
      if (!anchor) return absent("sufficient-evidence-not-dispatched");
      const a = local.accepted,
        v = local.visible;
      if (p.predicate_id === "latency.display") {
        if (!a) return absent("acceptance-not-observed");
        if (!v)
          return (ctx.observation_end ?? 0) >= a.at + q.budget_ms
            ? fail("missing-required-surface")
            : absent("window-not-ended");
        if (v.causal_id !== a.causal_id || v.version !== a.version)
          return fail("surface-causal-mismatch");
        const delay = v.at - a.at,
          error = (a.uncertainty_ms ?? 0) + (v.uncertainty_ms ?? 0);
        return delay + error <= q.budget_ms
          ? pass()
          : delay - error > q.budget_ms
            ? fail("late-display")
            : review("timing-uncertainty-overlaps-budget");
      }
      const end = p.predicate_id === "latency.total" ? v : a;
      if (!end)
        return (ctx.observation_end ?? 0) >=
          anchor.ready_at_driver + q.budget_ms
          ? fail("missing-due-checkpoint")
          : absent("tail-not-due");
      const delay = end.at - anchor.ready_at_driver,
        error = end.uncertainty_ms ?? 0;
      return delay + error <= q.budget_ms
        ? pass()
        : delay - error > q.budget_ms
          ? fail("late-semantic-or-surface-result")
          : review("timing-uncertainty-overlaps-budget");
    }
    case "recovery.resolved":
      if (!local.recovery) return absent("recovery-not-observed");
      return local.recovery.resolved &&
        local.recovery.authorized &&
        local.recovery.preserved_identity
        ? pass()
        : fail("invalid-or-missing-recovery");
    case "surface.matches": {
      if (!local.accepted) return absent("state-not-observed");
      const frames = local.frames ?? [];
      const good = frames.filter(
        (f) =>
          f.version === local.accepted.version &&
          f.causal_id === local.accepted.causal_id &&
          f.visible &&
          f.readable &&
          f.unoccluded &&
          f.in_safe_area &&
          f.content_matches === true &&
          (q.required_text ?? []).every((t) =>
            normalize(f.text).includes(normalize(t)),
          ),
      );
      if (!good.length) return fail("missing-or-incorrect-surface");
      if (
        q.minimum_visible_ms &&
        Math.max(...good.map((f) => f.at)) -
          Math.min(...good.map((f) => f.at)) <
          q.minimum_visible_ms
      )
        return fail("surface-flash-only");
      return pass();
    }
    case "surface.withdrawn":
      if (!Number.isFinite(local.invalidated_at))
        return absent("invalidation-not-observed");
      if (
        !local.observer_complete ||
        !(local.frames ?? []).some(
          (f) => f.at >= local.invalidated_at + q.budget_ms,
        )
      )
        return absent("withdrawal-observation-incomplete");
      return (local.frames ?? []).some(
        (f) =>
          f.at > local.invalidated_at + q.budget_ms &&
          f.version === local.old_version &&
          f.visible,
      )
        ? fail("stale-surface-remains")
        : pass();
    default:
      throw Error("unregistered-predicate:" + p.predicate_id);
  }
}
export function scoreScenario(input, ctx) {
  const scenario = validateScenario(input),
    ps = expectations(scenario),
    results = new Map();
  if (ctx.started === false)
    return {
      scenario_id: scenario.scenario_id,
      status: "NOT_RUN",
      results: [],
      first_violated_boundary: null,
    };
  const evaluate = (p) => {
    if (results.has(p.expectation_id)) return results.get(p.expectation_id);
    const blocked = p.prerequisites
      .map((d) => ({
        d,
        r: evaluate(ps.find((x) => x.expectation_id === d.id)),
      }))
      .filter(({ d, r }) =>
        d.condition === "pass"
          ? r.status !== "PASS"
          : r.status === "NOT_EXERCISED" || r.status === "NOT_RUN",
      )
      .map(({ d }) => d.id);
    let r;
    if (blocked.length)
      r = out("NOT_EXERCISED", "prerequisite-unobservable", {
        blocked_by: blocked,
      });
    else if (
      p.activation_rule === "stage_required" &&
      !scenario.stage_requirement.required
    )
      r = absent("stage-not-required");
    else if (
      p.activation_rule === "evidence_present" &&
      !p.evidence_refs.every((id) =>
        (ctx.timeline ?? []).some((e) => e.event_id === id),
      )
    )
      r = absent("activation-not-reached");
    else r = predicate(p, { ...ctx, scenario });
    const location = ctx.observations?.[p.expectation_id]?.location ?? {};
    r = {
      ...r,
      expectation_id: p.expectation_id,
      owner_layer: p.owner_layer,
      required: p.required,
      severity:
        r.status === "FAIL" &&
        p.owner_layer === "D" &&
        hardSemanticReasons.includes(r.reason)
          ? "hard"
          : p.severity,
      blocked_by: r.blocked_by ?? [],
      evidence_refs: p.evidence_refs,
      location,
    };
    results.set(p.expectation_id, r);
    return r;
  };
  ps.forEach(evaluate);
  const rows = ps.map((p) => results.get(p.expectation_id)),
    required = rows.filter((r) => r.required && r.severity !== "target");
  const failures = rows.filter((r) => r.status === "FAIL");
  // The collector supplies causal event order, not layer letters or evaluation iteration order.
  const ordered = [...failures].sort(
    (a, b) =>
      (a.location.causal_order ?? Infinity) -
      (b.location.causal_order ?? Infinity),
  );
  const status = required.some(
    (r) => r.owner_layer === "A" && r.status === "INVALID",
  )
    ? "INVALID"
    : required.some((r) => r.status === "FAIL") ||
        failures.some((r) => r.severity === "hard")
      ? "FAIL"
      : required.some((r) => r.status === "INVALID")
        ? "INVALID"
        : required.some((r) => r.status === null)
          ? null
          : required.some((r) => r.status === "NOT_EXERCISED")
            ? "NOT_EXERCISED"
            : "PASS";
  return {
    scenario_id: scenario.scenario_id,
    status,
    adjudication_status: rows.some((r) => r.status === null)
      ? "ADJUDICATION_REQUIRED"
      : "RESOLVED",
    results: rows,
    hard_fail: failures.some((r) => r.severity === "hard"),
    first_violated_boundary:
      ordered[0] && Number.isFinite(ordered[0].location.causal_order)
        ? {
            owner_layer: ordered[0].owner_layer,
            expectation_id: ordered[0].expectation_id,
            ...ordered[0].location,
          }
        : null,
    boundary_adjudication:
      failures.length && !Number.isFinite(ordered[0]?.location.causal_order)
        ? "ADJUDICATION_REQUIRED"
        : null,
    violations: failures,
    layers: Object.fromEntries(
      layers.map((layer) => [
        layer,
        rows.filter((r) => r.owner_layer === layer),
      ]),
    ),
    coverage: {
      required: required.length,
      passed: required.filter((r) => r.status === "PASS").length,
      blocked: required.filter((r) => r.status === "NOT_EXERCISED").length,
      failed: required.filter((r) => r.status === "FAIL").length,
    },
  };
}
