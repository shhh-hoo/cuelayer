import {
  same,
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
  version: "v2-live-request-1";
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
    role: "CONTEXT_ONLY" | "CARRY_CONTEXT";
    text: string;
  }[];
  cores: { id: string; title: string }[];
  units: {
    id: string;
    core: string;
    valid: boolean;
    meaning: ReturnType<typeof projectMeaning>;
    requires: string[];
  }[];
  currentCore: string | null;
  cue: { text: string; targets: string[]; origin: "TEACHER" } | null;
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
    dependencyClosureComplete: true;
  };
};
export type LiveCapture = {
  range: SourceRange;
  boundaries: Record<string, SourceCursor>;
  sources: Record<string, SourceRange>;
  cores: Record<string, string>;
  units: Record<string, string>;
  obligations: Record<string, string>;
  obligationVersions: Record<string, number>;
  request: LiveRequest;
  namespace: string;
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
export function selectState(replay: Replay, explicitCores?: string[]) {
  const selected = new Set(
    explicitCores ??
      [
        replay.state.currentCoreId,
        ...Object.values(replay.state.cores)
          .slice(-1)
          .map((c) => c.id),
      ].filter((id): id is string => Boolean(id)),
  );
  if (!explicitCores)
    for (const id of replay.state.cue?.targets ?? []) {
      const core = replay.state.units[id]?.coreId;
      if (core) selected.add(core);
    }
  let changed = true;
  while (changed) {
    changed = false;
    for (const u of Object.values(replay.state.units).filter((u) =>
      selected.has(u.coreId),
    )) {
      const refs = [
        ...u.requires,
        ...(u.meaning.kind === "relation"
          ? u.meaning.targets
          : u.meaning.kind === "annotation"
            ? [u.meaning.target]
            : []),
      ];
      for (const ref of refs) {
        const core = replay.state.units[ref]?.coreId;
        if (core && !selected.has(core)) {
          selected.add(core);
          changed = true;
        }
      }
    }
  }
  const state: TeachingState = {
    ...structuredClone(replay.state),
    cores: Object.fromEntries(
      Object.entries(replay.state.cores).filter(([id]) => selected.has(id)),
    ),
    units: Object.fromEntries(
      Object.entries(replay.state.units).filter(([, u]) =>
        selected.has(u.coreId),
      ),
    ),
  };
  const dependencies: Record<string, number> = {
    mainline: state.mainlineVersion,
    cue: state.cueVersion,
  };
  for (const id of selected)
    for (const k of [
      `core/${id}`,
      `members/${id}`,
      ...(state.cores[id]?.unitIds ?? []).map((id) => `unit/${id}`),
    ])
      dependencies[k] = version(state, k);
  return { state, dependencies, coreIds: [...selected] };
}
export function captureLive(
  replay: Replay,
  sessionId: string,
  nonce: string,
  epoch: number,
  budget = DEFAULT_BUDGET,
  explicitCores?: string[],
): Task {
  const { state, dependencies, coreIds } = selectState(replay, explicitCores);
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
    if (position(replay.evidence, before) < start) {
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
      version: "v2-live-request-1",
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
        title: c.title,
      })),
      units: Object.values(state.units).map((u) => ({
        id: unitAlias(u.id),
        core: coreAlias(u.coreId),
        valid: u.valid,
        meaning: projectMeaning(u.meaning, unitAlias),
        requires: u.requires.map(unitAlias),
      })),
      currentCore:
        state.currentCoreId && coreIds.includes(state.currentCoreId)
          ? coreAlias(state.currentCoreId)
          : null,
      cue: state.cue
        ? {
            text: state.cue.text,
            targets: state.cue.targets.map(unitAlias),
            origin: state.cue.origin,
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
      omitted: request.omitted,
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
      evidence: replay.evidence.filter((e) =>
        sourcePieces(replay.evidence, range).some((p) => p.evidenceId === e.id),
      ),
      obligations: carried.map((o) => replay.unresolved[obligations[o.id]]),
      createdAt: performance.now(),
      attentionEpoch: epoch,
      capture: {
        range,
        boundaries,
        sources,
        cores,
        units,
        obligations,
        obligationVersions,
        request,
        namespace: nonce,
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
) {
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
  const at = text.indexOf(quote);
  if (at < 0 || text.indexOf(quote, at + 1) >= 0)
    throw new Error("ungrounded-or-ambiguous-quote");
  const refs = map
    .slice(at, at + quote.length)
    .filter((p): p is number => p !== null);
  if (!refs.length) throw new Error("ungrounded-quote");
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
