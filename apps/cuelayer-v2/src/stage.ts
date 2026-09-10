import { z } from "zod";
import {
  type Task,
  type Replay,
  type Accepted,
  type Operation,
  version,
  same,
  semanticValue,
  semanticEqual,
} from "./contract";
import {
  wireOperationSchema,
  type WireOperation,
  projectMeaning,
} from "./live-wire";
import {
  selectState,
  aliasLookup,
  bytes,
  keyOf,
  DEFAULT_BUDGET,
  type LiveCapture,
} from "./projection";
import {
  position,
  cursorAt,
  rangeSize,
  readable,
  sourcePieces,
  legalCursors,
  type SourceRange,
} from "./source";
import {
  requireThat,
  expandOperations,
  validateOperations,
} from "./acceptance";

export const STAGE_WIRE_VERSION = "v2-stage-review-1";
export type ReviewConcern = {
  id: string;
  version: number;
  range: SourceRange;
  coreId: string;
  purpose: string;
  createdAt: number;
};
export type ReviewItem = {
  id: string;
  kind: "OBLIGATION" | "RECONCILIATION";
  subjectId: string;
  version: number;
  range: SourceRange;
  coreId: string | null;
  purpose: string;
  key: string;
  createdAt: number;
};
const stageOperationSchema = z.union(
  wireOperationSchema.options.filter((s) =>
    ["put", "invalidate"].includes(s.shape.type.value),
  ) as [
    (typeof wireOperationSchema.options)[1],
    (typeof wireOperationSchema.options)[2],
  ],
);
export const stageReviewSchema = z
  .object({
    version: z.literal(STAGE_WIRE_VERSION),
    scope: z.string().min(1),
    results: z
      .array(
        z
          .object({
            item: z.string(),
            outcome: z.enum(["RESOLVED", "STILL_OPEN", "WITHDRAWN"]),
            operations: z.array(stageOperationSchema).max(24),
            supersededBy: z.string().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();
export type StageReview = z.infer<typeof stageReviewSchema>;
export type StageRequest = {
  version: "v2-stage-request-1";
  scope: string;
  items: {
    id: string;
    kind: ReviewItem["kind"];
    source: string;
    purpose: string;
    phrase: string;
    core: string | null;
  }[];
  context: { source: string; role: "REVIEW_CONTEXT"; text: string }[];
  cores: { id: string; title: string }[];
  units: {
    id: string;
    core: string;
    valid: boolean;
    meaning: ReturnType<typeof projectMeaning>;
    requires: string[];
  }[];
  newUnits: string[];
  omitted: {
    earlierSource: boolean;
    cores: number;
    reviewItems: number;
    dependencyClosureComplete: true;
  };
};
export type StageCapture = Pick<
  LiveCapture,
  | "cores"
  | "units"
  | "obligations"
  | "obligationVersions"
  | "sources"
  | "namespace"
> & { request: StageRequest; items: ReviewItem[] };
export function reviewCandidates(replay: Replay): Omit<ReviewItem, "key">[] {
  return [
    ...Object.values(replay.unresolved)
      .filter((o) => o.range)
      .map((o) => ({
        id: o.id,
        kind: "OBLIGATION" as const,
        subjectId: o.id,
        version: o.version ?? 1,
        range: o.range!,
        coreId: o.coreId,
        purpose: "Resolve grounded incomplete meaning or reference",
        createdAt: o.createdAt,
      })),
    ...Object.values(replay.reviewConcerns).map((o) => ({
      id: o.id,
      kind: "RECONCILIATION" as const,
      subjectId: o.id,
      version: o.version,
      range: o.range,
      coreId: o.coreId,
      purpose: o.purpose,
      createdAt: o.createdAt,
    })),
  ].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
export function captureStage(
  replay: Replay,
  sessionId: string,
  nonce: string,
  epoch: number,
  subject?: string,
): Task | null {
  const candidates = reviewCandidates(replay).filter(
    (i) => !subject || i.subjectId === subject,
  );
  for (const item of candidates) {
    // Source cannot exceed A; a Stage snapshot can never acquire a consumption port.
    requireThat(
      position(replay.evidence, item.range.end) <=
        position(replay.evidence, replay.accounted),
      "unaccounted-stage-scope",
    );
    const { state, dependencies, coreIds } = selectState(
      replay,
      item.coreId ? [item.coreId] : [],
    );
    delete dependencies.mainline;
    delete dependencies.cue;
    state.currentCoreId = null;
    state.mainlineVersion = 0;
    state.cue = null;
    state.cueVersion = 0;
    if (Object.keys(state.units).length > DEFAULT_BUDGET.maxUnits)
      throw new Error("stage-context-blocked:semantic-closure");
    const cores = Object.fromEntries(
      Object.keys(state.cores).map((id, i) => [`c${i}`, id]),
    );
    const units = Object.fromEntries(
      Object.keys(state.units).map((id, i) => [`u${i}`, id]),
    );
    const newUnits = Array.from({ length: 12 }, (_, i) => `nu${i}`);
    newUnits.forEach(
      (a, i) => (units[a] = `u:${sessionId}:Stage:${replay.sequence}:${i}`),
    );
    const ca = (id: string) =>
      Object.keys(cores).find((a) => cores[a] === id) ??
      (() => {
        throw new Error("stage-context-blocked:missing-core");
      })();
    const ua = (id: string) =>
      Object.keys(units).find((a) => units[a] === id) ??
      (() => {
        throw new Error("stage-context-blocked:missing-unit");
      })();
    const end = replay.accounted,
      at = position(replay.evidence, end);
    const start =
      legalCursors(replay.evidence, {
        start: cursorAt(replay.evidence, 0),
        end,
      }).find((c) => position(replay.evidence, c) >= Math.max(0, at - 3200)) ??
      end;
    const sources: Record<string, SourceRange> = {
      [`s0`]: item.range,
    };
    if (position(replay.evidence, start) < at) sources[`s1`] = { start, end };
    // Relevant recent evidence is captured; future/unrelated admission does not invalidate this immutable review.
    const key = keyOf({
      lane: "Stage",
      subject: item.subjectId,
      version: item.version,
      range: item.range,
      purpose: item.purpose,
      sources: Object.values(sources).map((range) => ({
        range,
        pieces: sourcePieces(replay.evidence, range),
      })),
      dependencies,
    });
    if (replay.reviewInspections[key]) continue;
    const id = `r0`;
    const request: StageRequest = {
      version: "v2-stage-request-1",
      scope: nonce,
      items: [
        {
          id,
          kind: item.kind,
          source: `s0`,
          purpose: item.purpose,
          phrase:
            item.kind === "OBLIGATION"
              ? replay.unresolved[item.subjectId].phrase
              : "",
          core: item.coreId ? ca(item.coreId) : null,
        },
      ],
      context: Object.entries(sources).map(([source, range]) => ({
        source,
        role: "REVIEW_CONTEXT",
        text: readable(replay.evidence, range),
      })),
      cores: Object.values(state.cores).map((c) => ({
        id: ca(c.id),
        title: c.title,
      })),
      units: Object.values(state.units).map((u) => ({
        id: ua(u.id),
        core: ca(u.coreId),
        valid: u.valid,
        meaning: projectMeaning(u.meaning, ua),
        requires: u.requires.map(ua),
      })),
      newUnits,
      omitted: {
        earlierSource: position(replay.evidence, start) > 0,
        cores: Object.keys(replay.state.cores).length - coreIds.length,
        reviewItems: candidates.length - 1,
        dependencyClosureComplete: true,
      },
    };
    if (bytes(request) > 28000)
      throw new Error("stage-context-blocked:request");
    const obligationVersions =
      item.kind === "OBLIGATION" ? { [item.subjectId]: item.version } : {};
    return {
      id: `${sessionId}:Stage:${nonce}`,
      sessionId,
      generation: replay.generation,
      inspectionKey: key,
      lane: "Stage",
      state,
      dependencies,
      allowedCores: coreIds,
      evidence: replay.evidence.filter((e) =>
        Object.values(sources).some((r) =>
          sourcePieces(replay.evidence, r).some((p) => p.evidenceId === e.id),
        ),
      ),
      obligations:
        item.kind === "OBLIGATION" ? [replay.unresolved[item.subjectId]] : [],
      createdAt: performance.now(),
      attentionEpoch: epoch,
      review: {
        cores,
        units,
        obligations: item.kind === "OBLIGATION" ? { [id]: item.subjectId } : {},
        obligationVersions,
        sources,
        namespace: nonce,
        request,
        items: [{ ...item, id, key }],
      },
    };
  }
  return null;
}
export function validateStage(replay: Replay, task: Task, raw: unknown) {
  const parsed = stageReviewSchema.safeParse(raw);
  requireThat(parsed.success, "incomplete-or-malformed-stage-review");
  requireThat(
    !replay.ended && task.lane === "Stage" && task.review,
    "invalid-stage-task",
  );
  const c = task.review!,
    p = parsed.data!;
  requireThat(p.scope === c.namespace, "task-binding");
  for (const [key, v] of Object.entries(task.dependencies))
    requireThat(version(replay.state, key) === v, `stale-dependency:${key}`);
  for (const e of task.evidence)
    requireThat(
      replay.evidence.some((current) => same(current, e)),
      "uncommitted-evidence",
    );
  requireThat(
    p.results.length === c.items.length &&
      new Set(p.results.map((r) => r.item)).size === p.results.length,
    "incomplete-stage-items",
  );
  let state = replay.state;
  const operations: Operation[] = [],
    resolved: string[] = [],
    reviews: NonNullable<Accepted["reviews"]> = [];
  for (const result of p.results) {
    const item = c.items.find((i) => i.id === result.item);
    requireThat(item, "unknown-or-cross-task-review-alias");
    const current =
      item!.kind === "OBLIGATION"
        ? replay.unresolved[item!.subjectId]
        : replay.reviewConcerns[item!.subjectId];
    requireThat(
      current?.version === item!.version,
      `stale-dependency:review/${item!.subjectId}`,
    );
    const ops = expandOperations(
      replay,
      task,
      result.operations as WireOperation[],
    );
    const next = validateOperations(state, task, ops);
    requireThat(
      !ops.length || !semanticEqual(semanticValue(state), semanticValue(next)),
      "semantic-no-op-stage",
    );
    if (result.outcome === "STILL_OPEN")
      requireThat(
        !ops.length && result.supersededBy === null,
        "still-open-cannot-mutate",
      );
    if (result.outcome === "RESOLVED") {
      requireThat(
        result.supersededBy === null,
        "invalid-resolution-supersession",
      );
      if (item!.kind === "OBLIGATION")
        requireThat(
          !semanticEqual(semanticValue(state), semanticValue(next)) &&
            ops.some((op) =>
              op.basis.some(
                (b) =>
                  b.range &&
                  position(replay.evidence, b.range.start) <
                    position(replay.evidence, item!.range.end) &&
                  position(replay.evidence, b.range.end) >
                    position(replay.evidence, item!.range.start),
              ),
            ),
          "ungrounded-stage-resolution",
        );
    }
    if (result.outcome === "WITHDRAWN") {
      requireThat(
        !ops.length && result.supersededBy,
        "withdrawal-needs-authority",
      );
      const id = aliasLookup(c.units, result.supersededBy!);
      const unit = state.units[id];
      // Only an already accepted explicit invalidation of a unit grounded in this exact concern is sufficient.
      requireThat(
        unit &&
          !unit.valid &&
          sourcePieces(replay.evidence, item!.range).every((piece) =>
            unit.basis.some(
              (b) =>
                b.range &&
                position(replay.evidence, b.range.start) <=
                  position(replay.evidence, {
                    evidenceId: piece.evidenceId,
                    sequence: piece.sequence,
                    offset: piece.start,
                  }) &&
                position(replay.evidence, b.range.end) >=
                  position(replay.evidence, {
                    evidenceId: piece.evidenceId,
                    sequence: piece.sequence,
                    offset: piece.end,
                  }),
            ),
          ),
        "withdrawal-without-authoritative-retraction",
      );
    }
    if (result.outcome !== "STILL_OPEN" && item!.kind === "OBLIGATION")
      resolved.push(item!.subjectId);
    operations.push(...ops);
    state = next;
    reviews.push({
      subjectId: item!.subjectId,
      kind: item!.kind,
      version: item!.version,
      key: item!.key,
      range: item!.range,
      purpose: item!.purpose,
      outcome: result.outcome,
    });
  }
  const accepted: Accepted = {
    taskId: task.id,
    lane: "Stage",
    dependencies: task.dependencies,
    operations,
    dispositions: [],
    unresolved: [],
    resolved,
    reviewed: [],
    reviewVersion: "v2-stage-processing-1",
    reviews,
  };
  return { proposal: { operations, attention: null }, accepted };
}
