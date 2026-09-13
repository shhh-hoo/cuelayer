import { readFile } from "node:fs/promises";

const nonempty = (x) => typeof x === "string" && x.trim().length > 0;
function require(condition, reason) {
  if (!condition) throw Error("natural-lesson-" + reason);
}
function unique(rows, field, reason) {
  require(Array.isArray(rows) && rows.length > 0, reason);
  require(rows.every((r) => nonempty(r?.[field])), reason);
  require(new Set(rows.map((r) => r[field])).size === rows.length, reason);
}
function refs(values, allowed, reason) {
  require(Array.isArray(values) && values.length > 0, reason);
  require(new Set(values).size === values.length &&
    values.every((v) => allowed.has(v)), reason);
}

/** Checks source/criterion integrity only. AUTHORED is not semantic review. */
export function validateNaturalLesson(lesson) {
  require(lesson?.identity ===
    "cuelayer-v2-natural-short-lesson-1", "identity");
  require(nonempty(lesson.lesson_id), "id");
  require(["AUTHORED", "REVIEWED"].includes(
    lesson.review_status,
  ), "review-status");
  require(lesson.source?.kind === "authored" &&
    lesson.source.private === false, "source");
  require(Number.isInteger(lesson.duration_ms) &&
    lesson.duration_ms > 0, "duration");
  unique(lesson.transcript_events, "event_id", "events");
  let previous = -1;
  for (const e of lesson.transcript_events) {
    require(Number.isInteger(e.at_ms) &&
      e.at_ms > previous &&
      e.at_ms < lesson.duration_ms, "event-order");
    require(nonempty(e.text), "event-text");
    previous = e.at_ms;
  }
  unique(lesson.checkpoints, "id", "checkpoints");
  previous = -1;
  for (const c of lesson.checkpoints) {
    require(!["pre_reload", "post_reload"].includes(
      c.id,
    ), "reserved-checkpoint");
    require(Number.isInteger(c.at_ms) &&
      c.at_ms > previous &&
      c.at_ms <= lesson.duration_ms &&
      nonempty(c.why), "checkpoint-order");
    previous = c.at_ms;
  }
  const sources = new Set(lesson.transcript_events.map((e) => e.event_id));
  const checkpoints = new Set([
    ...lesson.checkpoints.map((c) => c.id),
    "pre_reload",
    "post_reload",
  ]);
  require(nonempty(lesson.oracle?.rubric), "rubric");
  unique(lesson.oracle.criteria, "id", "criteria");
  for (const c of lesson.oracle.criteria) {
    require(nonempty(c.claim), "claim");
    refs(c.evidence_refs, sources, "criterion-evidence");
    refs(c.checkpoint_ids, checkpoints, "criterion-checkpoints");
  }
  unique(lesson.oracle.bindings, "key", "bindings");
  for (const b of lesson.oracle.bindings) {
    require(checkpoints.has(b.checkpoint_id) &&
      b.meaning_kind === "quantity", "binding-scope");
    unique(b.field_grounding, "field", "field-grounding");
    for (const f of b.field_grounding) {
      require([
        "expression",
        "symbols",
        "conditions",
        "independent",
        "domain",
      ].includes(f.field), "field");
      refs(f.evidence_any, sources, "field-evidence");
    }
  }
  const keys = new Set(lesson.oracle.bindings.map((b) => b.key));
  for (const kind of ["same_identity", "distinct_identity"]) {
    require(Array.isArray(lesson.oracle[kind]), "identity-rules");
    for (const group of lesson.oracle[kind]) {
      refs(group, keys, "identity-rule");
      require(group.length >= 2, "identity-rule");
    }
  }
  return lesson;
}

export async function loadNaturalLesson(
  path = new URL("./lesson.json", import.meta.url),
) {
  return validateNaturalLesson(JSON.parse(await readFile(path, "utf8")));
}
