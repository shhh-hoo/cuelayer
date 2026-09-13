import { z } from "zod";
import { readFile } from "node:fs/promises";
import { sha256 } from "../evidence.mjs";

export const MICRO_CORPUS_IDENTITY = "cuelayer-v2-semantic-microcorpus-1";
const text = z.string().min(1);
const refs = z.array(text);
const assertion = z
  .object({ id: text, claim: text, evidence_refs: refs.min(1) })
  .strict();
const unit = z
  .object({ key: text, meaning: z.record(z.string(), z.unknown()) })
  .strict();
const step = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("ESTABLISH"),
      evidence_refs: refs.min(1),
      units: z.array(unit).min(1),
      field_sources: z
        .record(z.string(), z.record(z.string(), refs.min(1)))
        .optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("CARRY"),
      evidence_refs: refs.min(1),
      kind: z.enum([
        "INCOMPLETE_PROPOSITION",
        "UNRESOLVED_REFERENCE",
        "CONTEXT_REQUIRED",
      ]),
      core: z.literal("lesson").nullable(),
    })
    .strict(),
  z
    .object({ action: z.literal("NO_CHANGE"), evidence_refs: refs.min(1) })
    .strict(),
]);
export const microCaseSchema = z
  .object({
    case_id: text,
    lane: z.enum(["Live", "Stage"]),
    evidence: z.array(z.object({ event_id: text, text }).strict()).min(1),
    setup: z.array(step),
    oracle: z
      .object({
        applicable_metrics: z
          .array(
            z.enum([
              "disposition",
              "knowledge_mutation",
              "end_state",
              "reference_resolution",
              "provenance",
              "false_terminal_no_change",
            ]),
          )
          .min(1),
        allowed_dispositions: z
          .array(
            z.enum([
              "WAIT",
              "CARRY",
              "NO_CHANGE",
              "APPLY",
              "STILL_OPEN",
              "RESOLVED",
              "CONFIRMED_NO_CHANGE",
              "READY_FOR_LIVE",
            ]),
          )
          .min(1),
        required: z.array(assertion).min(1),
        forbidden: z.array(assertion).min(1),
        identity_rules: refs,
        field_grounding: z.array(
          z
            .object({
              unit_key: text,
              field: text,
              required_evidence: refs.min(1),
              forbidden_evidence: refs,
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();
const corpusSchema = z
  .object({
    identity: z.literal(MICRO_CORPUS_IDENTITY),
    review_status: z.enum(["AUTHORED", "REVIEWED"]),
    source: text,
    oracle_policy: z
      .object({
        semantic_equivalence: text,
        dispositions: text,
        scope: text,
        failure_denominator: text,
        review: text,
      })
      .strict(),
    pairs: z
      .array(
        z
          .object({
            pair_id: text,
            distinction: text,
            cases: z.array(microCaseSchema).length(2),
          })
          .strict(),
      )
      .length(13),
  })
  .strict();
const unique = (xs, label) => {
  if (new Set(xs).size !== xs.length) throw Error("duplicate-" + label);
};
export function validateMicroCorpus(raw) {
  const corpus = corpusSchema.parse(raw),
    cases = corpus.pairs.flatMap((p) => p.cases);
  unique(
    corpus.pairs.map((p) => p.pair_id),
    "pair",
  );
  unique(
    cases.map((c) => c.case_id),
    "case",
  );
  for (const c of cases) {
    const ids = c.evidence.map((e) => e.event_id),
      known = new Set(ids),
      used = [];
    unique(ids, "evidence");
    const check = (xs) => {
      unique(xs, "reference");
      for (const id of xs)
        if (!known.has(id))
          throw Error("unknown-evidence:" + c.case_id + ":" + id);
    };
    const assertions = [...c.oracle.required, ...c.oracle.forbidden];
    unique(
      assertions.map((a) => a.id),
      "assertion",
    );
    assertions.forEach((a) => check(a.evidence_refs));
    const keys = [];
    for (const s of c.setup) {
      check(s.evidence_refs);
      used.push(...s.evidence_refs);
      if (s.action === "ESTABLISH") {
        for (const u of s.units) {
          keys.push(u.key);
          if (
            ![
              "statement",
              "quantity",
              "reaction",
              "relation",
              "annotation",
            ].includes(u.meaning.kind)
          )
            throw Error("invalid-fixture-meaning-kind");
        }
        for (const [key, fields] of Object.entries(s.field_sources ?? {})) {
          if (!s.units.some((u) => u.key === key))
            throw Error("unknown-fixture-unit");
          for (const values of Object.values(fields)) {
            check(values);
            if (values.some((id) => !s.evidence_refs.includes(id)))
              throw Error("field-outside-setup");
          }
        }
      }
    }
    unique(keys, "fixture-unit");
    unique(used, "setup-evidence");
    if (JSON.stringify(used) !== JSON.stringify(ids.slice(0, used.length)))
      throw Error("setup-not-contiguous-prefix:" + c.case_id);
    if (c.lane === "Live" && used.length === ids.length)
      throw Error("no-live-process-evidence");
    if (
      c.lane === "Stage" &&
      !c.setup.some((s) => ["CARRY", "NO_CHANGE"].includes(s.action))
    )
      throw Error("no-stage-review-precondition");
    for (const f of c.oracle.field_grounding) {
      check(f.required_evidence);
      check(f.forbidden_evidence);
      if (f.required_evidence.some((id) => f.forbidden_evidence.includes(id)))
        throw Error("contradictory-field-evidence");
      if (!keys.includes(f.unit_key) && !f.unit_key.startsWith("new-"))
        throw Error("unknown-oracle-unit");
    }
    unique(c.oracle.allowed_dispositions, "disposition");
    const laneDispositions =
      c.lane === "Live"
        ? ["WAIT", "CARRY", "NO_CHANGE", "APPLY"]
        : [
            "STILL_OPEN",
            "RESOLVED",
            "CONFIRMED_NO_CHANGE",
            "CARRY",
            "READY_FOR_LIVE",
          ];
    if (
      c.oracle.allowed_dispositions.some((d) => !laneDispositions.includes(d))
    )
      throw Error("wrong-lane-disposition");
  }
  return corpus;
}
export async function loadMicroCorpus() {
  return validateMicroCorpus(
    JSON.parse(
      await readFile(new URL("./micro-corpus.json", import.meta.url), "utf8"),
    ),
  );
}
export function corpusIdentity(corpus) {
  const c = validateMicroCorpus(corpus);
  return {
    identity: c.identity,
    review_status: c.review_status,
    pairs: c.pairs.length,
    cases: c.pairs.reduce((n, p) => n + p.cases.length, 0),
    corpus_sha256: sha256(c),
    oracle_sha256: sha256(
      c.pairs.flatMap((p) =>
        p.cases.map((c) => ({ case_id: c.case_id, oracle: c.oracle })),
      ),
    ),
  };
}
