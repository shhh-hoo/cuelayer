// Independent contract assessment. Does not call selectState/capture to reconstruct an ideal request.
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function assessProjection(snapshot, requirements = {}) {
  const { task, replay, request } = snapshot,
    c = task.capture ?? task.review;
  const violations = [],
    missing = [],
    provided = Object.values(c.sources);
  const cursor = (c) => {
    if (!c.sequence) return 0;
    return (
      replay.evidence
        .slice(0, c.sequence - 1)
        .reduce((n, e) => n + e.text.length, 0) + c.offset
    );
  };
  const R = cursor(replay.recorded),
    A = cursor(replay.accounted);
  const rawRange = (range) =>
    replay.evidence
      .flatMap((e) => {
        if (
          e.sequence < range.start.sequence ||
          e.sequence > range.end.sequence
        )
          return [];
        const start =
            e.sequence === range.start.sequence ? range.start.offset : 0,
          end =
            e.sequence === range.end.sequence
              ? range.end.offset
              : e.text.length;
        return end > start ? [e.text.slice(start, end)] : [];
      })
      .reduce(
        (out, text) =>
          out +
          (!out ||
          /\s$/.test(out) ||
          /^[\s\p{P}]/u.test(text) ||
          (/\p{Script=Han}$/u.test(out) && /^\p{Script=Han}/u.test(text))
            ? ""
            : " ") +
          text,
        "",
      );
  const inRange = (inner, outer) =>
    cursor(inner.start) >= cursor(outer.start) &&
    cursor(inner.end) <= cursor(outer.end);
  const ids = Object.keys(c.units ?? {}).filter(
    (a) => replay.state.units[c.units[a]],
  );
  if (task.lane === "Live") {
    if (!equal(c.range.start, replay.accounted) || cursor(c.range.end) > R)
      violations.push("incorrect-process-frontier");
    if (cursor(c.range.start) >= cursor(c.range.end))
      violations.push("empty-process-source");
    if (request.source?.role !== "PROCESS")
      violations.push("incorrect-source-role");
    const expectedSource = c.request.source;
    if (!equal(request.source, expectedSource))
      violations.push("process-text-or-range-changed");
    if (
      request.writableUnits.some(
        (a) => !task.writeScope.units.includes(c.units[a]),
      )
    )
      violations.push("modify-authority-expanded");
    if (
      request.createWithin.some(
        (a) => !task.writeScope.createIn.includes(c.cores[a]),
      )
    )
      violations.push("create-authority-expanded");
  } else {
    if ("source" in request || "accountThrough" in request)
      violations.push("stage-source-consumption");
    if (
      (request.writableUnits ?? []).some(
        (a) => !task.writeScope.units.includes(c.units[a]),
      )
    )
      violations.push("modify-authority-expanded");
    if (
      (request.createWithin ?? []).some(
        (a) => !task.writeScope.createIn.includes(c.cores[a]),
      )
    )
      violations.push("create-authority-expanded");
  }
  for (const range of provided)
    if (cursor(range.end) > R || cursor(range.start) < 0)
      violations.push("future-evidence-leak");
  const declaredTexts =
    task.lane === "Live"
      ? [request.source, ...request.context]
      : request.context;
  for (const entry of declaredTexts) {
    const range = c.sources[entry.source];
    if (!range || entry.text.replace(/<b\d+>/g, "") !== rawRange(range))
      violations.push("source-text-not-derived-from-admitted-evidence");
    if (
      task.lane === "Live" &&
      entry === request.source &&
      range &&
      !equal(range, c.range)
    )
      violations.push("process-range-alias-mismatch");
    if (entry !== request.source && entry.role === "PROCESS")
      violations.push("accounted-history-reconsumed");
    const original = (
      task.lane === "Live"
        ? [c.request.source, ...c.request.context]
        : c.request.context
    ).find((x) => x.source === entry.source);
    if (!original || entry.text !== original.text)
      violations.push("unissued-source-text");
  }
  for (const unit of request.units ?? []) {
    if (!ids.includes(unit.id)) violations.push("unissued-readable-unit");
    if (
      !equal(
        unit,
        c.request.units.find((x) => x.id === unit.id),
      )
    )
      violations.push("unit-state-altered");
    const canonical = c.units[unit.id];
    if (
      canonical &&
      !equal(task.state.units[canonical], replay.state.units[canonical])
    )
      violations.push("captured-state-differs-from-accepted-state");
  }
  for (const r of requirements.required_ranges ?? [])
    if (!provided.some((p) => inRange(r, p))) missing.push("source-range");
  for (const id of requirements.required_units ?? [])
    if (!(request.units ?? []).some((u) => c.units[u.id] === id))
      missing.push("accepted-unit:" + id);
  for (const id of requirements.required_obligations ?? [])
    if (
      !(request.obligations ?? request.items ?? []).some(
        (o) =>
          c.obligations?.[o.id] === id ||
          task.review?.items.some((i) => i.id === o.id && i.subjectId === id),
      )
    )
      missing.push("carry-obligation:" + id);
  for (const id of requirements.required_evidence_ids ?? []) {
    const event = replay.evidence.find((e) => e.id === id);
    if (!event) {
      missing.push("required-precondition-evidence:" + id);
      continue;
    }
    const range = {
      start: { sequence: event.sequence, offset: 0 },
      end: { sequence: event.sequence, offset: event.text.length },
    };
    const exposed = provided.some((p) => inRange(range, p));
    const accepted = (request.units ?? []).some((u) =>
      replay.state.units[c.units[u.id]]?.basis.some((b) => b.evidenceId === id),
    );
    if (!exposed && !(requirements.accepted_grounding_sufficient && accepted))
      missing.push("required-evidence-or-accepted-context:" + id);
  }
  if (missing.length && !requirements.allow_context_request)
    violations.push(...missing.map((x) => "necessary-state-omitted:" + x));
  return {
    violations: [...new Set(violations)],
    missing,
    answerability:
      missing.length || requirements.semantic_clarification_missing
        ? "CONTEXT_REQUIRED"
        : "SUFFICIENT",
    R,
    A,
    context_only_ranges: provided.filter((r) => cursor(r.end) <= A),
    task_id: task.id,
  };
}
