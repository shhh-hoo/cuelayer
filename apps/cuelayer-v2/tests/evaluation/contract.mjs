import { z } from "zod";
export const PRODUCT_SHA = "1a796e8c713b6f00ef9beb72004b456833a82ff5";
export const layers = ["A", "B", "C", "D", "E", "F", "G", "H"];
export const statuses = ["PASS", "FAIL", "INVALID", "NOT_EXERCISED", "NOT_RUN"];
export const hardSemanticReasons = [
  "false-numeric-value",
  "false-proposition",
  "false-operator-or-arity",
  "operand-binding",
  "wrong-physical-unit",
  "wrong-unit-or-variable-role",
  "missing-number-or-unit",
  "missing-units",
  "missing-truth-critical-condition",
  "forbidden-established-meaning",
  "false-quantity-role",
  "relation-endpoints-or-direction",
];
const id = z.string().min(1);
const refs = z.array(id);
const predicateOwners = {
  "experiment.valid": "A",
  "transcript.admitted": "B",
  "request.adequate": "C",
  "model.schema": "D",
  "meaning.matches": "D",
  "meaning.forbidden": "D",
  "cue.matches": "D",
  "state.identity": "E",
  "carry.preserved": "G",
  "host.contract": "E",
  "frontier.progress": "F",
  "checkpoint.due": "F",
  "recovery.resolved": "G",
  "surface.matches": "H",
  "surface.withdrawn": "H",
  "latency.semantic": "F",
  "latency.display": "H",
  "latency.total": "H",
};
export const predicateSchema = z
  .object({
    expectation_id: id,
    owner_layer: z.enum(layers),
    required: z.boolean(),
    activation_rule: z.enum(["always", "evidence_present", "stage_required"]),
    prerequisites: z.array(
      z.object({ id, condition: z.enum(["pass", "observable"]) }).strict(),
    ),
    predicate_id: z.enum(Object.keys(predicateOwners)),
    parameters: z.record(z.string(), z.unknown()),
    evidence_refs: refs,
    severity: z.enum(["hard", "ordinary", "target"]),
    sufficient_evidence_sets: z
      .array(
        z
          .object({
            set_id: id,
            event_ids: refs.min(1),
            invalidated_by: refs,
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export const scenarioSchema = z
  .object({
    scenario_id: id,
    version: id,
    review_status: z.enum(["AUTHORED", "REVIEWED"]),
    source: z
      .object({
        kind: z.enum(["authored", "recorded"]),
        identity: id,
        hash: z.string().optional(),
      })
      .strict(),
    duration_ms: z.number().nonnegative(),
    transcript_events: z
      .array(
        z
          .object({
            event_id: id,
            at_ms: z.number().nonnegative(),
            text: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    semantic_checkpoints: z.array(predicateSchema),
    forbidden_predicates: z.array(predicateSchema),
    allowed_equivalences: z.array(
      z
        .object({
          equivalence_id: id,
          description: id,
          kind: z.enum([
            "exact-text",
            "scalar-unit",
            "commutative-product",
            "symbol-renaming",
          ]),
          values: z.array(z.string()),
        })
        .strict(),
    ),
    surface_expectations: z.array(predicateSchema),
    timing_expectations: z.array(predicateSchema),
    adjudication_rules: z
      .array(z.object({ rule_id: id, scope: refs, rubric: id }).strict())
      .min(1),
    projection_expectations: z.array(predicateSchema),
    mechanism_expectations: z.array(predicateSchema),
    preconditions: z
      .object({
        kind: z.enum(["empty", "accepted-events"]),
        event_fixture: z.string().nullable(),
      })
      .strict(),
    coverage_requirements: z.array(
      z.object({ kind: id, event_ids: refs.min(1) }).strict(),
    ),
    stage_requirement: z
      .object({
        required: z.boolean(),
        why_wider_context: z.string(),
        trigger_event_ids: refs,
        wider_context_event_ids: refs,
        useful_resolution_predicates: refs,
      })
      .strict(),
  })
  .strict();
export function expectations(s) {
  return [
    "semantic_checkpoints",
    "forbidden_predicates",
    "surface_expectations",
    "timing_expectations",
    "projection_expectations",
    "mechanism_expectations",
  ].flatMap((k) => s[k]);
}
export function validateScenario(value) {
  const s = scenarioSchema.parse(value),
    ps = expectations(s);
  const unique = (xs, label) => {
    if (new Set(xs).size !== xs.length) throw Error("duplicate-" + label);
  };
  unique(
    s.transcript_events.map((e) => e.event_id),
    "event",
  );
  unique(
    ps.map((p) => p.expectation_id),
    "expectation",
  );
  unique(
    s.allowed_equivalences.map((e) => e.equivalence_id),
    "equivalence",
  );
  const events = new Set(s.transcript_events.map((e) => e.event_id)),
    ids = new Map(ps.map((p) => [p.expectation_id, p]));
  const checkRefs = (xs) =>
    xs.forEach((r) => {
      if (!events.has(r)) throw Error("unknown-evidence:" + r);
    });
  s.transcript_events.forEach((e, i) => {
    if (
      e.at_ms > s.duration_ms ||
      (i && e.at_ms < s.transcript_events[i - 1].at_ms)
    )
      throw Error("invalid-timeline");
  });
  for (const p of ps) {
    if (predicateOwners[p.predicate_id] !== p.owner_layer)
      throw Error("predicate-owner:" + p.expectation_id);
    checkRefs(p.evidence_refs);
    if (p.activation_rule === "evidence_present" && !p.evidence_refs.length)
      throw Error("empty-activation");
    if (p.activation_rule === "stage_required" && !s.stage_requirement.required)
      throw Error("contradictory-stage-activation");
    for (const q of p.prerequisites)
      if (!ids.has(q.id) || q.id === p.expectation_id)
        throw Error("invalid-prerequisite:" + q.id);
    if (
      p.predicate_id.startsWith("latency.") &&
      (!Number.isFinite(p.parameters.budget_ms) || p.parameters.budget_ms <= 0)
    )
      throw Error("unfrozen-timing");
    if (p.parameters.checkpoint_id && !ids.has(p.parameters.checkpoint_id))
      throw Error("unknown-checkpoint");
    if (
      p.parameters.checkpoint_id &&
      !ids.get(p.parameters.checkpoint_id).sufficient_evidence_sets?.length
    )
      throw Error("checkpoint-readiness-undefined");
    if (
      [
        "surface.matches",
        "latency.display",
        "latency.semantic",
        "latency.total",
        "checkpoint.due",
      ].includes(p.predicate_id) &&
      !p.parameters.checkpoint_id
    )
      throw Error("checkpoint-reference-required");
    if (
      p.predicate_id === "surface.matches" &&
      (!Number.isFinite(p.parameters.minimum_visible_ms) ||
        p.parameters.minimum_visible_ms < 100)
    )
      throw Error("unfrozen-surface-duration");
    if (
      p.predicate_id === "surface.withdrawn" &&
      !Number.isFinite(p.parameters.budget_ms)
    )
      throw Error("unfrozen-withdrawal-timing");
    if (
      p.predicate_id === "meaning.matches" &&
      ![
        "scalar",
        "product_equation",
        "exact_claims",
        "expected_outcome",
        "relation",
      ].some((k) => p.parameters[k])
    )
      throw Error("undefined-semantic-predicate");
    if (
      p.predicate_id === "meaning.forbidden" &&
      !["scalar", "false_claims", "any_unit"].some((k) => p.parameters[k])
    )
      throw Error("undefined-false-predicate");
    if (
      p.sufficient_evidence_sets?.some((set) =>
        set.event_ids.some((id) => set.invalidated_by.includes(id)),
      )
    )
      throw Error("contradictory-readiness-validity");
    if (p.sufficient_evidence_sets) {
      if (!p.sufficient_evidence_sets.length) throw Error("empty-readiness");
      unique(
        p.sufficient_evidence_sets.map((x) => x.set_id),
        "readiness-set",
      );
      for (const set of p.sufficient_evidence_sets) {
        checkRefs(set.event_ids);
        checkRefs(set.invalidated_by);
        unique(set.event_ids, "readiness-event");
      }
    }
  }
  for (const p of s.semantic_checkpoints)
    if (!p.sufficient_evidence_sets?.length)
      throw Error("undefined-readiness:" + p.expectation_id);
  const visiting = new Set(),
    done = new Set();
  const visit = (p) => {
    if (visiting.has(p.expectation_id)) throw Error("dependency-cycle");
    if (done.has(p.expectation_id)) return;
    visiting.add(p.expectation_id);
    p.prerequisites.forEach((q) => visit(ids.get(q.id)));
    visiting.delete(p.expectation_id);
    done.add(p.expectation_id);
  };
  ps.forEach(visit);
  s.coverage_requirements.forEach((c) => checkRefs(c.event_ids));
  checkRefs(s.stage_requirement.trigger_event_ids);
  checkRefs(s.stage_requirement.wider_context_event_ids);
  if (
    s.stage_requirement.required &&
    (!s.stage_requirement.why_wider_context ||
      !s.stage_requirement.wider_context_event_ids.length ||
      !s.stage_requirement.useful_resolution_predicates.length)
  )
    throw Error("unjustified-stage-hard-gate");
  for (const r of s.stage_requirement.useful_resolution_predicates)
    if (ids.get(r)?.owner_layer !== "G")
      throw Error("invalid-stage-resolution");
  s.adjudication_rules.forEach((r) =>
    r.scope.forEach((x) => {
      if (!ids.has(x)) throw Error("unknown-adjudication-scope");
    }),
  );
  for (const p of ps)
    if (
      ["meaning.matches", "meaning.forbidden", "cue.matches"].includes(
        p.predicate_id,
      ) &&
      !s.adjudication_rules.some((r) => r.scope.includes(p.expectation_id))
    )
      throw Error("missing-frozen-adjudication-rule");
  return s;
}
export const profile = Object.freeze({
  identity: "gate3b-text-pipeline-profile-1",
  B_live: 8000,
  B_stage: 20000,
  B_display: 1000,
  display_targets: { median_ms: 2500, p95_ms: 4000, hard: false },
  driver_lateness: { p95_ms: 100, max_ms: 500 },
  clock_uncertainty_max_ms: 100,
  clock_drift_max_ms: 1000,
  warmup_ms: 30000,
  window_ms: 60000,
  source_ratio_min: 0.9,
  drain_ms: 35000,
  finalization_count: 1,
  model_requested: "gpt-5.6-luna",
  reasoning_effort: "low",
  max_output_tokens: 8192,
  provider_deadline_ms: 6000,
  host_deadline_ms: 8000,
  sdk_retries: 0,
  transport_retries: 2,
  coalesce_ms: 250,
  max_wait_ms: 750,
  source_chars: 2400,
  preceding_chars: 800,
  max_request_bytes: 28000,
  max_units: 48,
  carry_chars: 1600,
  max_requests: 400,
  max_cost_usd: 10,
  prices_per_million: { input: 0.2, output: 1.2, cached_input: 0.02 },
  // Worst reservation includes long-context/cache-write pricing; no cache discount guarantee.
  reservation_per_request_usd: 0.54,
  readiness_rule:
    "earliest-driver-complete; ties-in-declared-set-order; product-uses-same-set",
  phases: [
    { id: "3b-0", paid: false },
    { id: "3b-1", paid: true, snapshots: 6 },
    { id: "3b-2+3b-3", paid: true, runs: 24 },
    { id: "3b-4", paid: true, runs: 1 },
    { id: "report", paid: false },
  ],
});
