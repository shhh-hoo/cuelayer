import { references, semanticIndex } from "./semantic-index";
import {
  same,
  isCurrent,
  version,
  type Task,
  type Replay,
  type Evidence,
  type TeachingState,
} from "./contract";
import {
  boundedRange,
  position,
  cursorAt,
  legalCursors,
  readable,
  sourcePieces,
  separator,
  rangeSize,
  type SourceRange,
  type SourceCursor,
} from "./source";
import { projectMeaning } from "./live-wire";

export type LiveRequest = {
  version: "v2-live-request-2";
  scope: string;
  mode: "CONTINUOUS" | "FINALIZE";
  source: {
    role: "PROCESS";
    text: string;
    start: string;
    end: string;
    source: string;
  };
  context: {
    source: string;
    role: "CONTEXT_ONLY" | "FOLLOWING_CONTEXT" | "CARRY_CONTEXT";
    text: string;
  }[];
  cores: { id: string; label: string }[];
  units: {
    id: string;
    core: string;
    valid: boolean;
    meaning: ReturnType<typeof projectMeaning>;
    dependencies: { target: string; kind: "IDENTITY" | "VALUE" }[];
  }[];
  writableUnits: string[];
  createWithin: string[];
  labelCores: string[];
  search: { query: string; results: string[]; nextAfter: string | null } | null;
  currentCore: string | null;
  cue: { text: string; targets: string[] } | null;
  obligations: {
    id: string;
    kind: string;
    phrase: string;
    core: string | null;
    source: string;
  }[];
  newCores: string[];
  newUnits: string[];
  omitted: {
    sourceAfter: boolean;
    preceding: boolean;
    cores: number;
    obligations: number;
    units: number;
    sourceGaps: SourceRange[];
    dependencyClosureComplete: true;
  };
};
export type LiveCapture = {
  range: SourceRange;
  boundaries: Record<string, SourceCursor>;
  sources: Record<string, SourceRange>;
  sourceBoundaries: Record<string, Record<string, SourceCursor>>;
  cores: Record<string, string>;
  units: Record<string, string>;
  obligations: Record<string, string>;
  obligationVersions: Record<string, number>;
  request: LiveRequest;
  namespace: string;
  inspectionContext?: import("./contract").InspectionContext;
};
export const DEFAULT_BUDGET = {
  sourceChars: 2400,
  precedingChars: 800,
  maxRequestBytes: 28000,
  maxUnits: 48,
  carryChars: 1600,
};
export const bytes = (v: unknown) =>
  new TextEncoder().encode(JSON.stringify(v)).length;
export const keyOf = (v: unknown) => JSON.stringify(v); // Exact basis, never a source identity hash.
export function selectState(
  replay: Replay,
  explicitCores?: string[],
  options: {
    roots?: string[];
    query?: string;
    range?: SourceRange;
    modify?: boolean;
    after?: string | null;
    exclude?: string[];
    prefer?: string[];
  } = {},
) {
  const all = replay.state,
    index = semanticIndex(all);
  const permitted = (id: string) =>
    !explicitCores || explicitCores.includes(all.units[id]?.coreId);
  const workingCores =
    explicitCores ??
    (all.currentCoreId
      ? [all.currentCoreId]
      : Object.keys(all.cores).slice(-1));
  const recent = Object.values(all.units)
    .filter((u) => isCurrent(all, u.id) && workingCores.includes(u.coreId))
    .sort(
      (a, b) =>
        (b.changedAt ?? 0) - (a.changedAt ?? 0) ||
        Object.keys(all.units).indexOf(b.id) -
          Object.keys(all.units).indexOf(a.id),
    )
    .slice(0, 8)
    .map((u) => u.id);
  const overlapping = options.range
    ? index
        .overlaps(replay.evidence, options.range)
        .filter((id) => permitted(id) && isCurrent(all, id))
    : [];
  const query = options.query ?? "";
  const matches = index
    .search(query)
    .filter((id) => permitted(id) && isCurrent(all, id));
  const candidates = matches.filter((id) => !options.exclude?.includes(id));
  const retained = (options.prefer ?? []).filter((id) =>
    candidates.includes(id),
  );
  const retrieved = [
    ...retained,
    ...candidates.filter((id) => !retained.includes(id)),
  ].slice(0, 8);
  const required = [
    ...new Set([
      ...(options.roots ?? []),
      ...overlapping,
      ...(!explicitCores
        ? (all.cue?.targets ?? []).filter((id) => isCurrent(all, id))
        : []),
    ]),
  ];
  const selected = new Set<string>();
  const add = (id: string, required: boolean) => {
    const closure = new Set<string>();
    const visit = (id: string) => {
      if (closure.has(id) || selected.has(id)) return;
      const unit = all.units[id];
      if (!unit) throw new Error("context-blocked:missing-reference");
      if (!unit.valid && !options.roots?.includes(id)) return;
      closure.add(id);
      references(unit).forEach(visit);
    };
    visit(id);
    if (selected.size + closure.size > DEFAULT_BUDGET.maxUnits) {
      if (required) throw new Error("context-blocked:semantic-closure");
      return;
    }
    closure.forEach((id) => selected.add(id));
  };
  required.forEach((id) => add(id, true));
  [...recent, ...retrieved].forEach((id) => add(id, false));
  const coreIds = [
    ...new Set([
      ...workingCores.filter((id): id is string => Boolean(id)),
      ...[...selected].map((id) => all.units[id].coreId),
    ]),
  ];
  const state: TeachingState = {
    ...all,
    cores: Object.fromEntries(
      coreIds.map((id) => [
        id,
        {
          ...all.cores[id],
          unitIds: all.cores[id].unitIds.filter((id) => selected.has(id)),
        },
      ]),
    ),
    units: Object.fromEntries(
      [...selected].map((id) => [id, structuredClone(all.units[id])]),
    ),
    cue:
      all.cue && all.cue.targets.every((id) => selected.has(id))
        ? structuredClone(all.cue)
        : null,
  };
  const dependencies: Record<string, number> = {
    mainline: all.mainlineVersion,
    cue: all.cueVersion,
  };
  coreIds.forEach((id) => {
    dependencies[`core/${id}`] = version(all, `core/${id}`);
  });
  selected.forEach((id) => {
    dependencies[`unit/${id}`] = version(all, `unit/${id}`);
  });
  const writes = [
    ...new Set([
      ...(options.roots ?? []),
      ...overlapping,
      ...recent,
      ...(options.modify ? retrieved : []),
    ]),
  ].filter((id) => selected.has(id));
  return {
    state,
    dependencies,
    coreIds,
    retrieved,
    writeScope: {
      units: writes,
      createIn: coreIds.filter((id) => workingCores.includes(id)),
      labels: coreIds.filter((id) => id === all.currentCoreId),
      mainline: !explicitCores,
      cue: !explicitCores,
    },
  };
}
export function captureLive(
  replay: Replay,
  sessionId: string,
  nonce: string,
  epoch: number,
  budget = DEFAULT_BUDGET,
  explicitCores?: string[],
): Task {
  const nominal = boundedRange(
    replay.evidence,
    replay.accounted,
    budget.sourceChars,
  );
  const queryContext = Object.values(replay.inspectionContexts)
    .filter(
      (c) =>
        c.query &&
        position(replay.evidence, c.anchor.start) ===
          position(replay.evidence, replay.accounted),
    )
    .at(-1);
  const queryPages = Object.values(replay.inspectionContexts).filter(
    (c) =>
      c.query?.query === queryContext?.query?.query &&
      c.query &&
      position(replay.evidence, c.anchor.start) ===
        position(replay.evidence, replay.accounted),
  );
  const pageAfter = queryContext?.query?.after ?? null;
  const excluded =
    pageAfter === null
      ? []
      : queryPages
          .filter((c) => c.pageAfter !== pageAfter)
          .flatMap((c) => c.results ?? []);
  const preferred = queryPages
    .filter((c) => c.pageAfter === pageAfter)
    .at(-1)?.results;
  const { state, dependencies, coreIds, writeScope, retrieved } = selectState(
    replay,
    explicitCores,
    {
      range: nominal,
      query: queryContext?.query?.query ?? readable(replay.evidence, nominal),
      modify: queryContext?.query?.purpose === "MODIFY",
      exclude: excluded,
      prefer: preferred,
    },
  );
  const providedRetrieved = retrieved.filter((id) => state.units[id]);
  writeScope.mainline = true;
  writeScope.cue = true;
  if (Object.keys(state.units).length > budget.maxUnits)
    throw new Error("context-blocked:semantic-closure");
  let limit = budget.sourceChars,
    lo = 1,
    hi = budget.sourceChars;
  let best: Task | undefined;
  for (;;) {
    const range = boundedRange(replay.evidence, replay.accounted, limit);
    const boundaries = Object.fromEntries(
      legalCursors(replay.evidence, range).map((c, i) => [`b${i}`, c]),
    );
    const sources: Record<string, SourceRange> = { [`s0`]: range };
    const cores = Object.fromEntries(
      Object.keys(state.cores).map((id, i) => [`c${i}`, id]),
    );
    const units = Object.fromEntries(
      Object.keys(state.units).map((id, i) => [`u${i}`, id]),
    );
    const newCores = Array.from({ length: 4 }, (_, i) => `nc${i}`),
      newUnits = Array.from({ length: 24 }, (_, i) => `nu${i}`);
    newCores.forEach(
      (a, i) =>
        (cores[a] =
          `c:${sessionId}:${Object.keys(replay.state.cores).length + i}`),
    );
    newUnits.forEach(
      (a, i) =>
        (units[a] =
          `u:${sessionId}:${Object.keys(replay.state.units).length + i}`),
    );
    const coreAlias = (id: string) =>
      Object.keys(cores).find((a) => cores[a] === id) ??
      (() => {
        throw new Error("context-blocked:core-reference");
      })();
    const unitAlias = (id: string) =>
      Object.keys(units).find((a) => units[a] === id) ??
      (() => {
        throw new Error("context-blocked:unit-reference");
      })();
    const context: LiveRequest["context"] = [];
    const inspected = Object.values(replay.inspectionContexts).filter(
      (c) =>
        position(replay.evidence, c.anchor.start) ===
          position(replay.evidence, range.start) &&
        position(replay.evidence, c.anchor.end) ===
          position(replay.evidence, range.end),
    );
    const nextStart = inspected.at(-1)?.following?.end ?? range.end;
    const hasFollowing =
      position(replay.evidence, nextStart) <
      position(replay.evidence, replay.recorded);
    const following =
      inspected.length && hasFollowing
        ? boundedRange(replay.evidence, nextStart, budget.precedingChars)
        : undefined;
    // Keep the last real page when nothing new exists: the same basis stays suppressed.
    const page = following ?? inspected.at(-1)?.following;
    const inspectionContext = {
      anchor: range,
      ...(page ? { following: page } : {}),
      ...(queryContext?.query
        ? { query: queryContext.query, results: providedRetrieved, pageAfter }
        : {}),
    };
    if (page) {
      sources.s1 = page;
      context.push({
        source: "s1",
        role: "FOLLOWING_CONTEXT",
        text: readable(replay.evidence, page),
      });
    }
    const start = position(replay.evidence, range.start);
    // Retain whole immediately preceding lexical pieces; never alter source text.
    const allCuts = legalCursors(replay.evidence, {
      start: cursorAt(replay.evidence, 0),
      end: range.start,
    });
    const before =
      allCuts.find(
        (c) =>
          position(replay.evidence, c) >=
          Math.max(0, start - budget.precedingChars),
      ) ?? range.start;
    if (!page && position(replay.evidence, before) < start) {
      const r = { start: before, end: range.start },
        a = `s${Object.keys(sources).length}`;
      sources[a] = r;
      context.push({
        source: a,
        role: "CONTEXT_ONLY",
        text: readable(replay.evidence, r),
      });
    }
    const obligations: Record<string, string> = {},
      obligationVersions: Record<string, number> = {};
    const carried: LiveRequest["obligations"] = [];
    let carryChars = 0;
    const relevant = Object.values(replay.unresolved).filter(
      (o) => !o.coreId || coreIds.includes(o.coreId),
    );
    for (const o of relevant.slice().reverse()) {
      if (
        !o.range ||
        carryChars + rangeSize(replay.evidence, o.range) > budget.carryChars
      )
        continue;
      carryChars += rangeSize(replay.evidence, o.range);
      const id = `o${carried.length}`,
        source = `s${Object.keys(sources).length}`;
      obligations[id] = o.id;
      obligationVersions[o.id] = o.version ?? 1;
      sources[source] = o.range;
      carried.push({
        id,
        kind: o.kind ?? "LEGACY_UNSPECIFIED",
        phrase: o.phrase,
        core: o.coreId ? coreAlias(o.coreId) : null,
        source,
      });
      context.push({
        source,
        role: "CARRY_CONTEXT",
        text: readable(replay.evidence, o.range),
      });
    }
    const sourceBoundaries = Object.fromEntries(
      Object.entries(sources).map(([a, r]) => [
        a,
        Object.fromEntries(
          legalCursors(replay.evidence, r).map((c, i) => [`b${i}`, c]),
        ),
      ]),
    );
    for (const entry of context)
      entry.text = projectSource(replay.evidence, sources[entry.source]).text;
    const cuts = Object.entries(boundaries);
    let text = `<${cuts[0][0]}>`;
    for (let i = 1; i < cuts.length; i++) {
      const segment = readable(replay.evidence, {
        start: cuts[i - 1][1],
        end: cuts[i][1],
      });
      const prev = cuts[i - 1][1],
        cur = cuts[i][1];
      const join =
        i > 1 &&
        prev.sequence > 0 &&
        cur.sequence > prev.sequence &&
        prev.offset === replay.evidence[prev.sequence - 1].text.length
          ? separator(replay.evidence[prev.sequence - 1].text, segment)
          : "";
      text += join + segment + `<${cuts[i][0]}>`;
    }
    const request: LiveRequest = {
      version: "v2-live-request-2",
      scope: nonce,
      mode: replay.captureClosed ? "FINALIZE" : "CONTINUOUS",
      source: {
        role: "PROCESS",
        text,
        start: cuts[0][0],
        end: cuts.at(-1)![0],
        source: `s0`,
      },
      context,
      cores: Object.values(state.cores).map((c) => ({
        id: coreAlias(c.id),
        label: c.label ?? c.title ?? "",
      })),
      units: Object.values(state.units).map((u) => ({
        id: unitAlias(u.id),
        core: coreAlias(u.coreId),
        valid: isCurrent(replay.state, u.id),
        meaning: projectMeaning(u.meaning, unitAlias),
        dependencies: (
          u.links ??
          u.requires.map((target) => ({ target, kind: "IDENTITY" as const }))
        ).map((d) => ({ target: unitAlias(d.target), kind: d.kind })),
      })),
      writableUnits: writeScope.units.map(unitAlias),
      createWithin: writeScope.createIn.map(coreAlias),
      labelCores: writeScope.labels.map(coreAlias),
      search: queryContext?.query
        ? {
            query: queryContext.query.query,
            results: providedRetrieved.map(unitAlias),
            nextAfter:
              providedRetrieved.length &&
              (retrieved.length === 8 ||
                providedRetrieved.length < retrieved.length)
                ? unitAlias(providedRetrieved.at(-1)!)
                : null,
          }
        : null,
      currentCore:
        state.currentCoreId && coreIds.includes(state.currentCoreId)
          ? coreAlias(state.currentCoreId)
          : null,
      cue: state.cue
        ? {
            text: state.cue.text,
            targets: state.cue.targets.map(unitAlias),
          }
        : null,
      obligations: carried,
      newCores,
      newUnits,
      omitted: {
        sourceAfter:
          position(replay.evidence, range.end) <
          position(replay.evidence, replay.recorded),
        preceding: position(replay.evidence, before) > 0,
        cores: Object.keys(replay.state.cores).length - coreIds.length,
        obligations: relevant.length - carried.length,
        units:
          Object.keys(replay.state.units).length -
          Object.keys(state.units).length,
        sourceGaps:
          page &&
          position(replay.evidence, page.start) >
            position(replay.evidence, range.end)
            ? [{ start: range.end, end: page.start }]
            : [],
        dependencyClosureComplete: true,
      },
    };
    if (bytes(request) > budget.maxRequestBytes) {
      hi = limit - 1;
      if (hi < lo) {
        if (best) return best;
        throw new Error("context-blocked:minimum-projection");
      }
      limit = Math.floor((lo + hi) / 2);
      continue;
    }
    const inspectionKey = keyOf({
      lane: "Live",
      generation: replay.generation,
      range,
      sources: Object.values(sources).map((r) => ({
        range: r,
        pieces: sourcePieces(replay.evidence, r),
      })),
      dependencies,
      obligationVersions,
      mode: request.mode,
      writeScope,
    });
    best = {
      id: `${sessionId}:Live:${nonce}`,
      sessionId,
      generation: replay.generation,
      inspectionKey,
      lane: "Live",
      state,
      dependencies,
      allowedCores: coreIds,
      writeScope,
      evidence: replay.evidence.filter((e) =>
        Object.values(sources).some((r) =>
          sourcePieces(replay.evidence, r).some((p) => p.evidenceId === e.id),
        ),
      ),
      obligations: carried.map((o) => replay.unresolved[obligations[o.id]]),
      createdAt: performance.now(),
      attentionEpoch: epoch,
      capture: {
        range,
        boundaries,
        sources,
        sourceBoundaries,
        cores,
        units,
        obligations,
        obligationVersions,
        request,
        namespace: nonce,
        inspectionContext,
      },
    };
    if (limit === budget.sourceChars || lo > hi) return best;
    lo = limit + 1;
    if (lo > hi) return best;
    limit = Math.floor((lo + hi) / 2);
  }
}
export function aliasLookup(map: Record<string, string>, alias: string) {
  const value = map[alias];
  if (!value) throw new Error("unknown-or-cross-task-alias");
  return value;
}
/** Exact quote -> exact durable pieces, including quotes crossing presentation-only spaces. */
export function expandBasis(
  evidence: Evidence[],
  range: SourceRange,
  quote: string,
  within?: SourceRange,
) {
  if (!quote) throw new Error("ungrounded-quote");
  let text = "",
    map: (number | null)[] = [];
  for (const p of sourcePieces(evidence, range)) {
    const join = separator(text, p.text);
    text += join;
    map.push(...Array(join.length).fill(null));
    const start = position(evidence, {
      evidenceId: p.evidenceId,
      sequence: p.sequence,
      offset: p.start,
    });
    text += p.text;
    for (let i = 0; i < p.text.length; i++) map.push(start + i);
  }
  const lower = within ? position(evidence, within.start) : -Infinity;
  const upper = within ? position(evidence, within.end) : Infinity;
  const matches: number[][] = [];
  let at = -1;
  let outside = false;
  while ((at = text.indexOf(quote, at + 1)) >= 0) {
    const refs = map
      .slice(at, at + quote.length)
      .filter((p): p is number => p !== null);
    if (!refs.length) throw new Error("ungrounded-quote");
    if (refs[0] < lower || refs.at(-1)! + 1 > upper) outside = true;
    else matches.push(refs);
  }
  if (!matches.length && outside)
    throw new Error("grounding-outside-processing-group");
  if (matches.length !== 1) throw new Error("ungrounded-or-ambiguous-quote");
  const refs = matches[0];
  const selected = {
    start: cursorAt(evidence, refs[0]),
    end: cursorAt(evidence, refs.at(-1)! + 1),
  };
  return sourcePieces(evidence, selected).map((p) => ({
    evidenceId: p.evidenceId,
    quote: p.text,
    range: {
      start: cursorAt(
        evidence,
        position(evidence, {
          evidenceId: p.evidenceId,
          sequence: p.sequence,
          offset: p.start,
        }),
      ),
      end: { evidenceId: p.evidenceId, sequence: p.sequence, offset: p.end },
    },
  }));
}

export function projectSource(evidence: Evidence[], range: SourceRange) {
  const cuts = legalCursors(evidence, range),
    boundaries = Object.fromEntries(cuts.map((c, i) => [`b${i}`, c]));
  let text = "<b0>";
  for (let i = 1; i < cuts.length; i++) {
    const segment = readable(evidence, { start: cuts[i - 1], end: cuts[i] });
    const prev = cuts[i - 1],
      cur = cuts[i];
    const join =
      i > 1 &&
      prev.sequence > 0 &&
      cur.sequence > prev.sequence &&
      prev.offset === evidence[prev.sequence - 1].text.length
        ? separator(evidence[prev.sequence - 1].text, segment)
        : "";
    text += join + segment + `<b${i}>`;
  }
  return { text, boundaries };
}
export function expandRangeBasis(
  evidence: Evidence[],
  capture: Pick<LiveCapture, "sources" | "sourceBoundaries">,
  ref: import("./live-wire").WireBasis,
  within?: SourceRange,
) {
  const range = capture.sources[ref.source],
    cuts = capture.sourceBoundaries[ref.source];
  if (!range || !cuts?.[ref.start] || !cuts?.[ref.end])
    throw new Error("unknown-or-cross-task-source-alias");
  const selected = { start: cuts[ref.start], end: cuts[ref.end] };
  const lo = position(evidence, selected.start),
    hi = position(evidence, selected.end);
  if (
    hi <= lo ||
    lo < position(evidence, range.start) ||
    hi > position(evidence, range.end)
  )
    throw new Error("invalid-grounding-range");
  if (
    within &&
    (lo < position(evidence, within.start) ||
      hi > position(evidence, within.end))
  )
    throw new Error("grounding-outside-processing-group");
  return sourcePieces(evidence, selected).map((p) => ({
    evidenceId: p.evidenceId,
    quote: p.text,
    range: {
      start: {
        evidenceId: p.evidenceId,
        sequence: p.sequence,
        offset: p.start,
      },
      end: { evidenceId: p.evidenceId, sequence: p.sequence, offset: p.end },
    },
  }));
}
