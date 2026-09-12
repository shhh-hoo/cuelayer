import { expectations, profile } from "./contract.mjs";
import { readiness, causalLatencies } from "./evidence.mjs";
import { assessProjection } from "./projection.mjs";
import { scoreScenario, selectUnits, meaningMatch } from "./score.mjs";
import { serialize } from "@cortex-js/compute-engine/latex-syntax";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normalized = (x) =>
  String(x ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
export function surfaceFidelity(frame, meaning) {
  if (!meaning) return false;
  const text = normalized(frame.text);
  if (meaning.kind === "quantity")
    return (
      frame.rendered_math === serialize(meaning.expression) &&
      Object.values(meaning.symbols).every(
        (s) =>
          text.includes(normalized(s.label)) &&
          text.includes(normalized(s.unit)),
      ) &&
      meaning.conditions.every((c) => text.includes(normalized(c)))
    );
  if (meaning.kind === "reaction")
    return (
      frame.rendered_math === `\\ce{${meaning.notation}}` &&
      meaning.conditions.every((c) => text.includes(normalized(c)))
    );
  return (frame.paragraphs ?? []).some(
    (p) => normalized(p) === normalized(meaning.text),
  );
}
export function stateContract(replay) {
  return {
    state: replay.state,
    accounted: replay.accounted,
    recorded: replay.recorded,
    unresolved: replay.unresolved,
    reviewConcerns: replay.reviewConcerns,
    reviewInspections: replay.reviewInspections,
  };
}
export function assessResponse(
  product,
  {
    task,
    prestate,
    response,
    events = [],
    poststate,
    validation_clock_interval,
  },
) {
  const schema = (
    task.lane === "Stage"
      ? product.stage.stageReviewSchema
      : product.wire.liveDecisionSchema
  ).safeParse(response);
  let reference,
    error = null;
  try {
    reference =
      task.lane === "Stage"
        ? product.stage.validateStage(prestate, task, response)
        : product.acceptance.validate(prestate, task, response);
  } catch (e) {
    error = e.message;
  }
  const actualEvent = events.find(
    (e) => e.type === "accepted" && e.accepted.taskId === task.id,
  );
  const shouldAccept = Boolean(
    reference && !(reference.decision && !reference.decision.groups.length),
  );
  let expected = prestate;
  if (shouldAccept) {
    // Event identity/timestamp comes from the observed append, never an invented gold state.
    const envelope = actualEvent ?? {
      schema: "cuelayer-v2-event-3",
      sessionId: task.sessionId,
      id: "missing-event",
      sequence: prestate.sequence + 1,
      at: 0,
      type: "accepted",
    };
    try {
      expected = product.contract.fold(prestate, {
        ...envelope,
        accepted: reference.accepted,
      });
    } catch (e) {
      error = "reference-fold:" + e.message;
    }
  }
  let proposed = prestate.state,
    semanticProjectionError = null;
  try {
    if (reference)
      proposed = product.contract.reduceSemanticOperations(
        prestate.state,
        reference.accepted.operations,
      );
    else if (schema.success) {
      // Semantic decoding is independent of mechanical acceptance. Unsupported decoding stays pending.
      const c = task.capture ?? task.review,
        operations = (response.groups ?? response.results ?? []).flatMap(
          (g) => g.operations ?? [],
        );
      const puts = operations
        .filter((o) => o.type === "put")
        .map((o) => ({
          id: c.units[o.id] ?? o.id,
          coreId: c.cores[o.coreId] ?? o.coreId,
          meaning: product.wire.compileMeaning(
            o.meaning,
            (a) => c.units[a] ?? a,
          ),
          basis: product.acceptance.expandGrounding(prestate, task, o.basis),
          requires: [],
          dependencies: [],
          version: 1,
        }));
      proposed = {
        ...proposed,
        units: {
          ...proposed.units,
          ...Object.fromEntries(puts.map((u) => [u.id, u])),
        },
      };
      if (operations.some((o) => o.type === "revise"))
        semanticProjectionError =
          "inadmissible-revision-requires-frozen-adjudication";
    }
  } catch (e) {
    semanticProjectionError = e.message;
  }
  const units = Object.values(proposed.units).filter((u) =>
    reference ? product.contract.isCurrent(proposed, u.id) : true,
  );
  const expectedContract = stateContract(expected),
    actualContract = stateContract(poststate ?? prestate);
  let timestamp_contract_valid = true;
  for (const key of ["unresolved", "reviewConcerns"]) {
    for (const [id, entry] of Object.entries(expectedContract[key] ?? {})) {
      if (prestate[key]?.[id]?.createdAt === entry.createdAt) continue;
      const actual = actualContract[key]?.[id]?.createdAt;
      if (!validation_clock_interval) {
        timestamp_contract_valid = null;
        continue;
      }
      if (
        Number.isFinite(actual) &&
        actual >= validation_clock_interval.before &&
        actual <= validation_clock_interval.after
      ) {
        // Comparison-only clock equivalence; raw expected, events and state remain retained.
        expectedContract[key] = {
          ...expectedContract[key],
          [id]: { ...entry, createdAt: actual },
        };
      } else timestamp_contract_valid = false;
    }
  }
  return {
    schema_valid: schema.success,
    response_complete: true,
    model_units: units,
    model_cue: proposed.cue,
    model_cue_version: proposed.cueVersion,
    outcomes: (response.groups ?? response.results ?? []).map((g) => g.outcome),
    semantic_projection_error: semanticProjectionError,
    host: {
      expected_accepted: shouldAccept,
      actual_accepted: Boolean(actualEvent),
      expected_state: expectedContract,
      actual_state: actualContract,
      reference_rejection: error,
      timestamp_contract_valid,
      validation_clock_interval,
    },
    reference,
    actualEvent,
  };
}
export function assessCanary(product, scenario, snapshot) {
  const task = snapshot.task,
    prestate = snapshot.prestate,
    request = snapshot.request;
  const response = assessResponse(product, {
    task,
    prestate,
    response: snapshot.response ?? snapshot.fixture_response,
    events: snapshot.events ?? snapshot.fixture_events,
    poststate: snapshot.poststate ?? snapshot.fixture_poststate,
    validation_clock_interval: snapshot.validation_clock_interval,
  });
  const projection = assessProjection(
      { task, replay: prestate, request },
      snapshot.requirements,
    ),
    observations = {};
  for (const p of expectations(scenario)) {
    observations[p.expectation_id] = {
      ...response,
      ...(p.parameters.proposition_v2
        ? { stage_prestate: prestate, stage_task: task }
        : {}),
      projection,
      location: {
        causal_order: p.owner_layer === "C" ? 1 : p.owner_layer === "D" ? 2 : 3,
        boundary: p.owner_layer,
        causal_event: task.id,
        predicate_id: p.predicate_id,
      },
    };
    if (p.owner_layer === "G")
      observations[p.expectation_id].recovery = {
        resolved: response.outcomes.every(
          (o) => o === p.parameters.expected_resolution,
        ),
        authorized:
          response.host.expected_accepted === response.host.actual_accepted,
        preserved_identity: same(
          prestate.accounted,
          (snapshot.poststate ?? snapshot.fixture_poststate).accounted,
        ),
      };
  }
  const timeline = scenario.transcript_events.map((e) => ({
    ...e,
    evaluator_dispatch_at: e.at_ms,
    page_received_at: e.at_ms,
    admitted_at: prestate.evidence.some(
      (x) => x.id === e.event_id && x.text === e.text,
    )
      ? e.at_ms
      : undefined,
  }));
  const assessment = scoreScenario(scenario, {
    started: true,
    validity_verified: true,
    timeline,
    observations,
  });
  // Frozen phase ownership: canary is only C/D/E/G. F and H stay explicitly unexercised.
  const required = assessment.results.filter(
    (r) => r.required && ["C", "D", "E", "G"].includes(r.owner_layer),
  );
  const phase_status = required.some((r) => r.status === "FAIL")
    ? "FAIL"
    : required.every((r) => r.status === "PASS")
      ? "PASS"
      : required.some((r) => r.status === null)
        ? null
        : "NOT_EXERCISED";
  return {
    ...assessment,
    phase: "3b-1",
    phase_status,
    exercised_layers: ["C", "D", "E", "G"],
    provider_invocations: 0,
    dependency_mode: snapshot.dependency_mode,
    host_reference: response.host,
  };
}
export function sourceWindows(frontier, start, end) {
  const windows = [];
  for (
    let a = start + profile.warmup_ms;
    a + profile.window_ms <= end;
    a += profile.window_ms
  ) {
    const b = a + profile.window_ms,
      before = frontier.findLast((r) => r.at <= a),
      after = frontier.findLast((r) => r.at <= b);
    if (!before || !after) {
      windows.push({ start: a, end: b, ratio: 0, evidence_missing: true });
      continue;
    }
    const deltaA = after.A - before.A,
      deltaR = after.R - before.R;
    windows.push({
      start: a,
      end: b,
      deltaA,
      deltaR,
      ratio: deltaR > 0 ? deltaA / deltaR : null,
    });
  }
  return windows;
}
export function assessJoint(product, scenario, recorded) {
  if (recorded.scenario_id !== scenario.scenario_id)
    throw Error("assessment-scenario-mismatch");
  const clock = recorded.clock_start,
    at = (x) => x - clock.offset;
  const timeline = recorded.timeline.rows.map((e) => ({
    ...e,
    page_received_at: at(e.page_received_at),
    admitted_at: at(e.admitted_at),
  }));
  const events = recorded.snapshot.events,
    journal = recorded.journal;
  const traces = journal.filter((r) => r.type === "trace");
  const samples = journal
    .filter((r) => r.type === "frame")
    .map((r) => ({ ...r, at: at(r.product_at) }));
  const requests = recorded.requests.map((r, index) => {
    const task = r.captured.task,
      validation = traces.find(
        (x) =>
          x.span.name === "semantic-validation-start" &&
          x.span.attributes.taskId === task.id,
      );
    const persisted = traces.find(
      (x) =>
        x.span.name === "persistence" && x.span.attributes.taskId === task.id,
    );
    const accepted = traces.find(
      (x) =>
        x.span.name === "semantic-accepted" &&
        x.span.attributes.taskId === task.id,
    );
    const prestate = validation?.replay ?? r.captured.prestate,
      poststate = persisted?.replay ?? prestate;
    const response = assessResponse(product, {
      task,
      prestate,
      response: r.response,
      poststate,
      events,
      validation_clock_interval:
        validation?.wall_at && persisted?.wall_at
          ? { before: validation.wall_at, after: persisted.wall_at }
          : null,
    });
    return {
      ...response,
      index,
      task,
      projection: assessProjection({
        task,
        replay: r.captured.prestate,
        request: r.request,
      }),
      source_ids: task.evidence.map((e) => e.id),
      at: at(r.captured.product_at),
      accepted_at: accepted ? at(accepted.span.end) : null,
      causal_id: task.id,
      request: r.request,
      raw_response: r.raw_response,
    };
  });
  const observations = {},
    latencies = [],
    checkpoints = [],
    frontier = samples.map((r) => ({ at: r.at, ...r.frontier }));
  const last = samples.at(-1)?.at ?? recorded.timeline.end;
  const relevant = (p) => {
    const target =
      expectations(scenario).find(
        (x) => x.expectation_id === p.parameters.checkpoint_id,
      ) ?? p;
    const anchor = readiness(target, timeline);
    const selectedSet = target.sufficient_evidence_sets?.find(
      (s) => s.set_id === anchor?.set_id,
    );
    const cutoff = Math.min(
      Infinity,
      ...(selectedSet?.invalidated_by ?? []).map(
        (id) =>
          timeline.find((e) => e.event_id === id)?.evaluator_dispatch_at ??
          Infinity,
      ),
    );
    return requests.filter(
      (r) =>
        (!anchor || r.at >= anchor.ready_at_driver - clock.uncertainty) &&
        r.at < cutoff &&
        (!target.evidence_refs.length ||
          target.evidence_refs.some((id) => r.source_ids.includes(id))),
    );
  };
  for (const p of expectations(scenario)) {
    const rows = relevant(p),
      r = rows.at(-1),
      location = r
        ? {
            causal_order: r.index,
            causal_event: r.causal_id,
            boundary: p.owner_layer,
            predicate_id: p.predicate_id,
          }
        : {};
    if (p.predicate_id === "request.adequate") {
      const checkpoint = scenario.semantic_checkpoints.find(
          (c) => c.expectation_id === p.parameters.checkpoint_id,
        ),
        anchor = checkpoint && readiness(checkpoint, timeline);
      const required_evidence_ids = anchor?.evidence_refs ?? [];
      const assessed = rows.map((r) =>
        assessProjection(
          {
            task: r.task,
            replay: recorded.requests[r.index].captured.prestate,
            request: r.request,
          },
          {
            required_evidence_ids,
            accepted_grounding_sufficient: true,
            allow_context_request: p.parameters.allow_context_request === true,
          },
        ),
      );
      observations[p.expectation_id] = {
        projection: rows.length
          ? {
              violations: assessed.flatMap((r) => r.violations),
              requests: assessed,
            }
          : null,
        location,
      };
    }
    if (p.predicate_id === "model.schema")
      observations[p.expectation_id] = {
        schema_valid: rows.length
          ? rows.every((r) => r.schema_valid)
          : undefined,
        location,
      };
    if (p.predicate_id === "host.contract")
      observations[p.expectation_id] = {
        host: rows.length
          ? {
              expected_accepted: true,
              actual_accepted: rows.every(
                (r) => r.host.expected_accepted === r.host.actual_accepted,
              ),
              expected_state: true,
              actual_state: rows.every((r) =>
                same(r.host.expected_state, r.host.actual_state),
              ),
              timestamp_contract_valid: rows.some(
                (r) => r.host.timestamp_contract_valid === false,
              )
                ? false
                : rows.some((r) => r.host.timestamp_contract_valid === null)
                  ? null
                  : true,
              details: rows.map((r) => r.host),
            }
          : null,
        location,
      };
    if (
      p.predicate_id.startsWith("meaning.") ||
      p.predicate_id === "cue.matches"
    ) {
      observations[p.expectation_id] = {
        ...(r ?? {}),
        history: rows,
        location,
      };
      if (
        p.predicate_id === "meaning.matches" ||
        p.predicate_id === "cue.matches"
      ) {
        const good = rows.find((r) =>
          p.predicate_id === "cue.matches"
            ? r.model_cue &&
              meaningMatch({ meaning: r.model_cue }, p.parameters).status ===
                "PASS"
            : p.parameters.expected_outcome
              ? r.outcomes.includes(p.parameters.expected_outcome)
              : selectUnits(r.model_units, p.parameters.selector).some(
                  (u) => meaningMatch(u, p.parameters).status === "PASS",
                ),
        );
        const anchor = readiness(p, timeline),
          unit =
            good &&
            selectUnits(good.model_units, p.parameters.selector).find(
              (u) => meaningMatch(u, p.parameters).status === "PASS",
            );
        // A later completion is recorded, but never moved into an earlier due window.
        const accepted =
          good?.accepted_at !== null && good?.accepted_at !== undefined
            ? {
                at: good.accepted_at,
                causal_id: good.causal_id,
                version:
                  p.predicate_id === "cue.matches"
                    ? good.model_cue_version
                    : (unit?.version ?? 0),
                unit_id: p.predicate_id === "cue.matches" ? null : unit?.id,
                uncertainty_ms: clock.uncertainty,
              }
            : null;
        const frames = accepted
          ? samples.flatMap((frame) =>
              frame.units
                .filter((u) => u.unit_id === accepted.unit_id)
                .map((u) => ({
                  ...u,
                  at: frame.at,
                  version: Number(u.version),
                  causal_id: accepted.causal_id,
                  uncertainty_ms: clock.uncertainty,
                  content_matches: surfaceFidelity(
                    u,
                    p.predicate_id === "cue.matches"
                      ? good.model_cue
                      : unit?.meaning,
                  ),
                })),
            )
          : [];
        const visible =
          frames.find(
            (f) =>
              f.at >= accepted.at &&
              f.version === accepted?.version &&
              f.visible &&
              f.readable &&
              f.unoccluded &&
              f.in_safe_area &&
              f.content_matches,
          ) ?? null;
        const causal = causalLatencies(p, timeline, accepted, visible);
        if (causal)
          latencies.push({
            checkpoint_id: p.expectation_id,
            ...causal,
            cache_state:
              recorded.dependency_mode === "STUB"
                ? "not-applicable"
                : "see-request-usage",
          });
        checkpoints.push({
          checkpoint_id: p.expectation_id,
          anchor,
          accepted,
          visible,
          frames,
          due_during_input: Boolean(
            anchor &&
            anchor.ready_at_driver + profile.B_live <= recorded.timeline.end,
          ),
          completed_during_input: Boolean(
            accepted && accepted.at <= recorded.timeline.end,
          ),
        });
      }
    }
  }
  for (const p of expectations(scenario)) {
    const checkpoint = checkpoints.find(
      (c) => c.checkpoint_id === p.parameters.checkpoint_id,
    );
    if (checkpoint)
      observations[p.expectation_id] = {
        ...observations[p.expectation_id],
        accepted: checkpoint.accepted,
        visible: checkpoint.visible,
        frames: checkpoint.frames,
        location: {
          causal_order: requests.findIndex(
            (r) => r.causal_id === checkpoint.accepted?.causal_id,
          ),
          causal_event: checkpoint.accepted?.causal_id,
          boundary: p.owner_layer,
          predicate_id: p.predicate_id,
        },
      };
    if (p.parameters.accepted_fidelity) {
      const actual = requests.find(
          (r) => r.accepted_at !== null && r.model_units.length,
        ),
        unit = actual?.model_units[0];
      const accepted =
        actual && unit
          ? {
              at: actual.accepted_at,
              causal_id: actual.causal_id,
              version: unit.version,
              unit_id: unit.id,
            }
          : null;
      observations[p.expectation_id] = {
        accepted,
        frames: accepted
          ? samples.flatMap((s) =>
              s.units
                .filter((u) => u.unit_id === unit.id)
                .map((u) => ({
                  ...u,
                  at: s.at,
                  version: Number(u.version),
                  causal_id: accepted.causal_id,
                  content_matches: surfaceFidelity(u, unit.meaning),
                })),
            )
          : [],
        location: {
          causal_order: actual?.index,
          causal_event: actual?.causal_id,
          boundary: "H",
        },
      };
    }
  }
  const faults = [];
  if (recorded.timeline.fidelity.status !== "PASS")
    faults.push({ kind: "evaluator-driver-late", independent_external: true });
  if (
    Math.abs(recorded.clock_end.offset - clock.offset) >
    profile.clock_drift_max_ms
  )
    faults.push({ kind: "clock-drift", independent_external: true });
  if (recorded.errors.length)
    faults.push(...recorded.errors.map((e) => ({ kind: e.boundary })));
  const stall = samples.find(
    (s) =>
      s.frontier.R > s.frontier.A &&
      s.window.oldestPendingAge > profile.B_live &&
      !s.window.activeLive &&
      s.window.status !== "WAITING",
  );
  observations.progress = {
    location: stall
      ? {
          causal_order: stall.at,
          boundary: "scheduler-frontier",
          causal_event: stall.product_at,
        }
      : null,
  };
  const ctx = {
    started: true,
    validity_verified: true,
    timeline,
    frontier,
    windows: sourceWindows(
      frontier,
      recorded.timeline.start,
      recorded.timeline.end,
    ),
    observation_end: last,
    observations,
    faults,
    stall_proven: Boolean(stall),
  };
  return {
    ...scoreScenario(scenario, ctx),
    dependency_mode: recorded.dependency_mode,
    provider_invocations: 0,
    latencies,
    requests,
    context: ctx,
    progress: {
      source: frontier.at(-1),
      due_semantic: checkpoints.filter((c) => c.due_during_input),
      tail_not_due: checkpoints.filter((c) => !c.due_during_input),
      carry: samples.map((s) => ({ at: s.at, obligations: s.carry })),
      required_surface: checkpoints.map((c) => ({
        checkpoint_id: c.checkpoint_id,
        visible: c.visible,
      })),
      drain_separate: true,
    },
  };
}
