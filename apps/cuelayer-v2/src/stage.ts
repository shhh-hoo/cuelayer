import { relatedSourceText } from "./semantic-index";
import { z } from "zod";
import {
  isCurrent,
  type Resolution,
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
  wireBasisSchema,
  type WireOperation,
  projectMeaning,
} from "./live-wire";
import {
  selectState,
  projectSource,
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
  validateResolution,
  affectedReviews,
} from "./acceptance";

export const STAGE_WIRE_VERSION = "v2-stage-review-4";
export type ReviewConcern = {
  id: string;
  version: number;
  range: SourceRange;
  coreId: string;
  purpose: string;
  createdAt: number;
  unitIds?: string[];
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
  unitIds?: string[];
};
const stageOperationSchema = z.union([
  wireOperationSchema.options[1],
  wireOperationSchema.options[2],
  wireOperationSchema.options[3],
]);
export const stageReviewSchema = z
  .object({
    scope: z.string().min(1),
    results: z
      .array(
        z.discriminatedUnion("outcome", [
          z
            .object({ item: z.string(), outcome: z.literal("STILL_OPEN") })
            .strict(),
          z
            .object({
              item: z.string(),
              outcome: z.literal("RESOLVED"),
              operations: z.array(stageOperationSchema).max(24),
              resolution: z
                .object({
                  targets: z.array(z.string()).min(1).max(8),
                  referents: z.array(z.string()).max(8),
                  basis: z.array(wireBasisSchema).min(1).max(24),
                })
                .strict()
                .nullable(),
            })
            .strict(),
          z
            .object({
              item: z.string(),
              outcome: z.literal("WITHDRAWN"),
              supersededBy: z.string(),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(4),
  })
  .strict();
export type StageReview = z.infer<typeof stageReviewSchema>;
export type StageRequest = {
  version: "v2-stage-request-4";
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
  cores: { id: string; label: string }[];
  writableUnits: string[];
  createWithin: string[];
  units: {
    id: string;
    core: string;
    valid: boolean;
    meaning: ReturnType<typeof projectMeaning>;
    dependencies: { target: string; kind: "IDENTITY" | "VALUE" }[];
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
  | "sourceBoundaries"
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
      unitIds: o.unitIds,
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
    if (
      position(replay.evidence, item.range.end) >
      position(replay.evidence, replay.accounted)
    )
      continue;
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
    const query =
      readable(replay.evidence, item.range) +
      " " +
      relatedSourceText(
        readable(replay.evidence, item.range),
        sourcePieces(replay.evidence, sources.s1 ?? sources.s0).map(
          (p) => p.text,
        ),
      );
    const { state, dependencies, coreIds, writeScope } = selectState(
      replay,
      item.coreId ? [item.coreId] : [],
      {
        query,
        roots:
          item.unitIds ??
          Object.values(replay.state.units)
            .filter(
              (u) =>
                u.coreId === item.coreId &&
                u.basis.some(
                  (b) =>
                    b.range &&
                    position(replay.evidence, b.range.start) <
                      position(replay.evidence, item.range.end) &&
                    position(replay.evidence, b.range.end) >
                      position(replay.evidence, item.range.start),
                ),
            )
            .map((u) => u.id),
        range: item.range,
      },
    );
    writeScope.units =
      item.unitIds ??
      Object.values(state.units)
        .filter(
          (u) =>
            u.coreId === item.coreId &&
            u.basis.some(
              (b) =>
                b.range &&
                position(replay.evidence, b.range.start) <
                  position(replay.evidence, item.range.end) &&
                position(replay.evidence, b.range.end) >
                  position(replay.evidence, item.range.start),
            ),
        )
        .map((u) => u.id);
    writeScope.labels = [];
    writeScope.mainline = false;
    writeScope.cue = false;
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
      version: "v2-stage-request-4",
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
        text: projectSource(replay.evidence, range).text,
      })),
      cores: Object.values(state.cores).map((c) => ({
        id: ca(c.id),
        label: c.label ?? c.title ?? "",
      })),
      units: Object.values(state.units).map((u) => ({
        id: ua(u.id),
        core: ca(u.coreId),
        valid: isCurrent(replay.state, u.id),
        meaning: projectMeaning(u.meaning, ua),
        dependencies: (
          u.links ??
          u.requires.map((target) => ({ target, kind: "IDENTITY" as const }))
        ).map((d) => ({ target: ua(d.target), kind: d.kind })),
      })),
      newUnits,
      writableUnits: writeScope.units.map(ua),
      createWithin: writeScope.createIn.map(ca),
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
      writeScope,
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
        sourceBoundaries: Object.fromEntries(
          Object.entries(sources).map(([s, r]) => [
            s,
            projectSource(replay.evidence, r).boundaries,
          ]),
        ),
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
  requireThat(task.generation === replay.generation, "stale-generation");
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
  const operationBatches: number[] = [];
  const operations: Operation[] = [],
    resolved: string[] = [],
    resolutions: Resolution[] = [],
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
      result.outcome === "RESOLVED"
        ? (result.operations as WireOperation[])
        : [],
    );
    const next = validateOperations(state, task, ops);
    requireThat(
      !ops.length || !semanticEqual(semanticValue(state), semanticValue(next)),
      "semantic-no-op-stage",
    );
    if (result.outcome === "RESOLVED") {
      if (item!.kind === "OBLIGATION") {
        requireThat(result.resolution, "missing-resolution-binding");
        const resolution = validateResolution(replay, task, next, {
          obligation: result.item,
          ...result.resolution!,
        });
        const referents = result.resolution!.referents.map((alias) =>
          aliasLookup(c.units, alias),
        );
        requireThat(
          new Set(referents).size === referents.length,
          "duplicate-stage-referent",
        );
        // The model selects antecedents. The host checks the accepted graph, never
        // guesses a referent from text, Core membership or the only visible unit.
        const closures = resolution.targets.map((target) => {
          const reachable = new Set<string>();
          const pending = [target];
          while (pending.length) {
            const id = pending.pop()!;
            if (reachable.has(id) || !isCurrent(next, id)) continue;
            reachable.add(id);
            pending.push(...next.units[id].requires);
          }
          if (referents.length && !task.state.units[target])
            requireThat(
              referents.some((id) => reachable.has(id)),
              "unbound-stage-referent",
            );
          return reachable;
        });
        for (const id of referents) {
          requireThat(
            task.state.units[id] &&
              Object.hasOwn(task.dependencies, `unit/${id}`) &&
              isCurrent(next, id),
            "invalid-stage-referent",
          );
          requireThat(
            closures.some((reachable) => reachable.has(id)),
            "unbound-stage-referent",
          );
        }
        resolutions.push({ ...resolution, referents });
      } else {
        requireThat(!result.resolution, "unexpected-resolution-binding");
        requireThat(
          (item!.unitIds ?? []).every(
            (id) => !next.units[id]?.valid || isCurrent(next, id),
          ),
          "review-still-required",
        );
      }
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
    operationBatches.push(ops.length);
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
    operationBatches,
    dispositions: [],
    unresolved: [],
    resolved,
    resolutions,
    reviewed: [],
    reviewVersion: "v2-stage-processing-1",
    reviews,
    reviewRequests: affectedReviews(replay, state, task.id),
  };
  return { proposal: { operations, attention: null }, accepted };
}
