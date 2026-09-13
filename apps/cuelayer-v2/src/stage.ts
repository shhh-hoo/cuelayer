import { relatedSourceText } from "./semantic-index";
import { z } from "zod";
import {
  isCurrent,
  type Resolution,
  type Task,
  type Replay,
  type Accepted,
  type Operation,
  type Unit,
  type SourceCursor,
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
  carryKindSchema,
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
  expandGrounding,
  validateOperations,
  validateResolution,
  affectedReviews,
} from "./acceptance";

export const STAGE_WIRE_VERSION = "v2-stage-review-5";
export type ReviewConcern = {
  kind?: "RECONCILIATION" | "SOURCE_NO_CHANGE";
  id: string;
  version: number;
  range: SourceRange;
  coreId: string | null;
  purpose: string;
  createdAt: number;
  unitIds?: string[];
  risk?: { version: "v2-terminal-risk-1"; reasons: string[] };
  readyForLive?: boolean;
  cursor?: SourceCursor;
};
export type ReviewItem = {
  id: string;
  kind: "OBLIGATION" | "RECONCILIATION" | "SOURCE_NO_CHANGE";
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
              reviewBasis: z.array(wireBasisSchema).min(1).max(24).optional(),
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
          z
            .object({
              item: z.string(),
              outcome: z.enum(["CONFIRMED_NO_CHANGE", "READY_FOR_LIVE"]),
            })
            .strict(),
          z
            .object({
              item: z.string(),
              outcome: z.literal("CARRY"),
              kind: carryKindSchema,
              core: z.string().nullable(),
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
  version: "v2-stage-request-6";
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
    followingSource?: boolean;
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
> & {
  request: StageRequest;
  items: ReviewItem[];
  sourceReview?: { horizon: SourceCursor; through: SourceCursor };
};
export function reviewCandidates(replay: Replay): Omit<ReviewItem, "key">[] {
  return [
    ...Object.values(replay.unresolved)
      .filter((o) => o.range && !o.sourceReview)
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
    ...Object.values(replay.reviewConcerns)
      .filter((o) => !o.readyForLive)
      .map((o) => ({
        id: o.id,
        kind: o.kind ?? ("RECONCILIATION" as const),
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
function captureSourceReview(
  replay: Replay,
  item: Omit<ReviewItem, "key">,
  sessionId: string,
  nonce: string,
  epoch: number,
  remaining: number,
): Task | null {
  const concern = replay.reviewConcerns[item.subjectId];
  const start = concern.cursor ?? item.range.end;
  const startAt = position(replay.evidence, start);
  const through =
    legalCursors(replay.evidence, { start, end: replay.accounted })
      .filter((cursor) => position(replay.evidence, cursor) <= startAt + 3200)
      .at(-1) ?? start;
  const sources: Record<string, SourceRange> = { s0: item.range };
  if (position(replay.evidence, through) > startAt)
    sources.s1 = { start, end: through };
  const core = item.coreId ? replay.state.cores[item.coreId] : undefined;
  const cores: Record<string, string> = core ? { c0: core.id } : {};
  const dependencies = core
    ? { [`core/${core.id}`]: version(replay.state, `core/${core.id}`) }
    : {};
  const state = {
    ...replay.state,
    cores: core ? { [core.id]: core } : {},
    units: {},
    currentCoreId: null,
    mainlineVersion: 0,
    cue: null,
    cueVersion: 0,
  };
  const key = keyOf({
    lane: "Stage",
    subject: item.subjectId,
    version: item.version,
    sources: Object.values(sources).map((range) => ({
      range,
      pieces: sourcePieces(replay.evidence, range),
    })),
    dependencies,
  });
  if (replay.reviewInspections[key]) return null;
  const request: StageRequest = {
    version: "v2-stage-request-6",
    scope: nonce,
    items: [
      {
        id: "r0",
        kind: "SOURCE_NO_CHANGE",
        source: "s0",
        purpose: item.purpose,
        phrase: readable(replay.evidence, item.range),
        core: core ? "c0" : null,
      },
    ],
    context: Object.entries(sources).map(([source, range]) => ({
      source,
      role: "REVIEW_CONTEXT",
      text: projectSource(replay.evidence, range).text,
    })),
    cores: core ? [{ id: "c0", label: core.label ?? core.title ?? "" }] : [],
    units: [],
    writableUnits: [],
    createWithin: [],
    newUnits: [],
    omitted: {
      earlierSource: position(replay.evidence, item.range.start) > 0,
      cores: Object.keys(replay.state.cores).length - Number(Boolean(core)),
      reviewItems: remaining,
      dependencyClosureComplete: true,
      followingSource:
        position(replay.evidence, through) <
        position(replay.evidence, replay.recorded),
    },
  };
  if (bytes(request) > 28000) throw new Error("stage-context-blocked:request");
  return {
    id: `${sessionId}:Stage:${nonce}`,
    sessionId,
    generation: replay.generation,
    inspectionKey: key,
    lane: "Stage",
    state,
    dependencies,
    allowedCores: core ? [core.id] : [],
    writeScope: {
      units: [],
      createIn: [],
      labels: [],
      mainline: false,
      cue: false,
    },
    evidence: replay.evidence.filter((e) =>
      Object.values(sources).some((range) =>
        sourcePieces(replay.evidence, range).some((p) => p.evidenceId === e.id),
      ),
    ),
    obligations: [],
    createdAt: performance.now(),
    attentionEpoch: epoch,
    review: {
      cores,
      units: {},
      obligations: {},
      obligationVersions: {},
      sources,
      sourceBoundaries: Object.fromEntries(
        Object.entries(sources).map(([source, range]) => [
          source,
          projectSource(replay.evidence, range).boundaries,
        ]),
      ),
      namespace: nonce,
      request,
      items: [{ ...item, id: "r0", key }],
      sourceReview: { horizon: replay.recorded, through },
    },
  };
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
    if (item.kind === "SOURCE_NO_CHANGE") {
      const task = captureSourceReview(
        replay,
        item,
        sessionId,
        nonce,
        epoch,
        candidates.length - 1,
      );
      if (task) return task;
      continue;
    }
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
      version: "v2-stage-request-6",
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
function bindingValue(unit: Unit | undefined) {
  return (
    unit && {
      meaning: unit.meaning,
      current: unit.valid && !unit.reviewRequired,
      links: (
        unit.links ??
        unit.requires.map((target) => ({ target, kind: "IDENTITY" as const }))
      )
        .map((link) =>
          link.kind === "IDENTITY"
            ? { target: link.target, kind: link.kind }
            : link,
        )
        .sort((a, b) => a.target.localeCompare(b.target)),
    }
  );
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
    reviews: NonNullable<Accepted["reviews"]> = [],
    sourceReviews: NonNullable<Accepted["sourceReviews"]> = [];
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
    if (item!.kind === "SOURCE_NO_CHANGE") {
      requireThat(
        "kind" in current &&
          current.kind === "SOURCE_NO_CHANGE" &&
          !current.readyForLive &&
          c.sourceReview &&
          !task.writeScope?.units.length &&
          !task.writeScope?.createIn.length &&
          !c.request.newUnits.length,
        "invalid-source-review-authority",
      );
      requireThat(
        [
          "STILL_OPEN",
          "CONFIRMED_NO_CHANGE",
          "CARRY",
          "READY_FOR_LIVE",
        ].includes(result.outcome),
        "source-review-cannot-write-knowledge",
      );
      if (result.outcome === "CONFIRMED_NO_CHANGE")
        requireThat(
          !c.request.omitted.followingSource &&
            same(c.sourceReview!.horizon, replay.recorded) &&
            position(replay.evidence, c.sourceReview!.through) ===
              position(replay.evidence, replay.recorded),
          "source-review-horizon-changed",
        );
      const coreId =
        result.outcome === "CARRY" && result.core
          ? aliasLookup(c.cores, result.core)
          : null;
      sourceReviews.push({
        version: "v2-terminal-review-1",
        subjectId: item!.subjectId,
        subjectVersion: item!.version,
        range: item!.range,
        inspectionKey: item!.key,
        outcome: result.outcome as NonNullable<
          Accepted["sourceReviews"]
        >[number]["outcome"],
        horizon: c.sourceReview!.horizon,
        through: c.sourceReview!.through,
        ...(result.outcome === "CARRY"
          ? { carry: { kind: result.kind, coreId } }
          : {}),
      });
      continue;
    }
    requireThat(
      ["RESOLVED", "STILL_OPEN", "WITHDRAWN"].includes(result.outcome),
      "unexpected-source-review-outcome",
    );
    const ops = expandOperations(
      replay,
      task,
      result.outcome === "RESOLVED"
        ? (result.operations as WireOperation[])
        : [],
    );
    const reviewBasis =
      result.outcome === "RESOLVED" && result.reviewBasis
        ? expandGrounding(replay, task, result.reviewBasis)
        : undefined;
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
        for (const id of referents)
          requireThat(
            task.state.units[id] &&
              Object.hasOwn(task.dependencies, `unit/${id}`) &&
              isCurrent(next, id),
            "invalid-stage-referent",
          );
        // New or semantically changed result units may connect several targets
        // through their typed links. Existing captured links remain forward-only:
        // an unrelated old relation or shared Core cannot bind a new resolution.
        const scope = new Set(Object.keys(task.state.units)),
          incoming = new Map<string, Set<string>>();
        for (const op of ops) {
          if (op.type === "put") scope.add(op.id);
          if (
            (op.type === "put" ||
              op.type === "revise" ||
              op.type === "revalidate") &&
            !semanticEqual(
              bindingValue(next.units[op.id]),
              bindingValue(state.units[op.id]),
            ) &&
            isCurrent(next, op.id)
          )
            for (const id of next.units[op.id].requires) {
              if (!incoming.has(id)) incoming.set(id, new Set());
              incoming.get(id)!.add(op.id);
            }
        }
        const closures = resolution.targets.map((target) => {
          const reachable = new Set<string>();
          const pending = [target];
          while (pending.length) {
            const id = pending.pop()!;
            if (reachable.has(id) || !scope.has(id) || !isCurrent(next, id))
              continue;
            reachable.add(id);
            pending.push(
              ...next.units[id].requires,
              ...(incoming.get(id) ?? []),
            );
          }
          if (referents.length)
            requireThat(
              referents.some((id) => reachable.has(id)),
              "unbound-stage-referent",
            );
          return reachable;
        });
        for (const id of referents)
          requireThat(
            closures.some((reachable) => reachable.has(id)),
            "unbound-stage-referent",
          );
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
      outcome: result.outcome as "RESOLVED" | "STILL_OPEN" | "WITHDRAWN",
      ...(reviewBasis ? { basis: reviewBasis } : {}),
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
    ...(sourceReviews.length ? { sourceReviews } : {}),
    reviewRequests: affectedReviews(replay, state, task.id),
  };
  return { proposal: { operations, attention: null }, accepted };
}
