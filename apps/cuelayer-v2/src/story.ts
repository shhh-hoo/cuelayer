import {
  reduceOperations,
  type Grounding,
  type Meaning,
  type LegacyOperation as Operation,
  type LegacyProposal,
  type Task,
} from "./contract";
import { fixtureBasis, authoredRevisions } from "./fixture-author";
import type { Interpreter, Session } from "./session";
import {
  projectMeaning,
  type LiveDecision,
  type WireOperation,
} from "./live-wire";
import { type StageReview } from "./stage";
import { type TeachingState } from "./contract";
export const story = [
  "A gas mixture contains several components. We are studying partial pressures.",
  "The Kc expression is ... I will clarify that later.",
  "For an ideal gas mixture, partial pressure p_i equals mole fraction x_i times total pressure P_total. Both pressures are measured in pascals; mole fraction is dimensionless.",
  "Mole fraction x_i equals amount n_i divided by total amount n_total. Amounts are measured in moles.",
  "Compare partial pressure and mole fraction. Think about what changes when total pressure increases.",
  "That fraction determines its share.",
  "By that fraction I mean the mole fraction.",
  "Now consider the reversible reaction N2 + 3 H2 <=> 2 NH3.",
  "Return to the gas mixture and its partial pressure relationship.",
  "Correction: the partial pressure relationship here assumes an ideal gas mixture at a common temperature.",
  "For a mathematical example, y equals sin x, with x in radians from zero to two pi and y dimensionless.",
];
const quantity = (
  expression: Extract<Meaning, { kind: "quantity" }>["expression"],
  symbols: Extract<Meaning, { kind: "quantity" }>["symbols"],
  conditions: string[],
): Meaning => ({ kind: "quantity", expression, symbols, conditions });
const pressure = quantity(
  ["Equal", "p_i", ["Multiply", "x_i", "P_total"]],
  {
    p_i: { label: "partial pressure", unit: "Pa" },
    x_i: { label: "mole fraction", unit: "dimensionless" },
    P_total: { label: "total pressure", unit: "Pa" },
  },
  ["Ideal gas mixture"],
);
const fraction = quantity(
  ["Equal", "x_i", ["Divide", "n_i", "n_total"]],
  {
    x_i: { label: "mole fraction", unit: "dimensionless" },
    n_i: { label: "component amount", unit: "mol" },
    n_total: { label: "total amount", unit: "mol" },
  },
  ["Amounts measured in moles"],
);
function authoredLegacyDecision(task: Task): LegacyProposal {
  const proposal: LegacyProposal = {
    version: "v2-proposal-1",
    taskId: task.id,
    complete: true,
    operations: [],
    dispositions: [],
    unresolved: [],
    resolve: [],
    attention: null,
  };
  let state = task.state;
  const add = (op: Operation) => {
    if (op.type === "mainline" && state.currentCoreId === op.coreId) return;
    proposal.operations.push(op);
    state = reduceOperations(state, [op]);
  };
  const put = (
    id: string,
    coreId: string,
    meaning: Meaning,
    basis: Grounding[],
    requires: string[] = [],
  ) => add({ type: "put", id, coreId, meaning, basis, requires });
  if (task.lane === "Stage") {
    const unresolved = task.obligations.find((o) => o.phrase === story[5]);
    const clue = task.evidence.find((e) => e.text === story[6]);
    if (unresolved && clue && state.units.fraction) {
      const previous = task.evidence.find((e) =>
        unresolved.evidenceIds.includes(e.id),
      )!;
      put(
        "fraction-share",
        "gases",
        {
          kind: "annotation",
          target: "fraction",
          text: "Mole fraction determines a component’s share.",
        },
        [
          { evidenceId: previous.id, quote: previous.text },
          { evidenceId: clue.id, quote: clue.text },
        ],
        ["fraction"],
      );
      proposal.resolve = [unresolved.id];
      proposal.attention = { mode: "FOCUS", targets: ["fraction-share"] };
    }
    return proposal;
  }
  for (const evidence of task.evidence) {
    const basis = [{ evidenceId: evidence.id, quote: evidence.text }],
      i = story.indexOf(evidence.text);
    const before = proposal.operations.length;
    switch (i) {
      case 0:
        if (!state.cores.gases) {
          add({ type: "core", id: "gases", title: "Gas mixtures", basis });
          put(
            "mixture",
            "gases",
            {
              kind: "statement",
              text: "A gas mixture contains several components.",
            },
            basis,
          );
        }
        add({ type: "mainline", coreId: "gases", basis });
        proposal.attention = { mode: "FOCUS", targets: ["mixture"] };
        break;
      case 1:
      case 5:
        proposal.unresolved.push({
          evidenceId: evidence.id,
          phrase: evidence.text,
          coreId: "gases",
        });
        break;
      case 2:
        put("pressure", "gases", pressure, basis);
        proposal.attention = { mode: "FOCUS", targets: ["pressure"] };
        break;
      case 3:
        put("fraction", "gases", fraction, basis, ["pressure"]);
        proposal.attention = { mode: "FOCUS", targets: ["fraction"] };
        break;
      case 4:
        put(
          "comparison",
          "gases",
          {
            kind: "relation",
            targets: ["pressure", "fraction"],
            relation: "comparison",
            text: "Partial pressure and mole fraction",
          },
          basis,
          ["pressure", "fraction"],
        );
        add({
          type: "cue",
          value: {
            text: "What changes when total pressure increases?",
            targets: ["pressure", "fraction"],
            origin: "TEACHER",
            basis,
          },
          basis,
        });
        proposal.attention = {
          mode: "COMPARE",
          targets: ["pressure", "fraction"],
        };
        break;
      case 7:
        if (!state.cores.reactions)
          add({
            type: "core",
            id: "reactions",
            title: "Chemical equilibrium",
            basis,
          });
        put(
          "ammonia",
          "reactions",
          {
            kind: "reaction",
            notation: "N2 + 3 H2 <=> 2 NH3",
            conditions: ["Reversible reaction"],
          },
          basis,
        );
        add({ type: "mainline", coreId: "reactions", basis });
        proposal.attention = { mode: "FOCUS", targets: ["ammonia"] };
        break;
      case 8:
        add({ type: "mainline", coreId: "gases", basis });
        proposal.attention = { mode: "FOCUS", targets: ["pressure"] };
        break;
      case 9:
        put(
          "pressure",
          "gases",
          {
            ...pressure,
            conditions: ["Ideal gas mixture", "Common temperature"],
          } as Meaning,
          [...state.units.pressure.basis, ...basis],
        );
        proposal.attention = { mode: "FOCUS", targets: ["pressure"] };
        break;
      case 10:
        if (!state.cores.functions)
          add({
            type: "core",
            id: "functions",
            title: "A function over a domain",
            basis,
          });
        put(
          "sine",
          "functions",
          {
            kind: "quantity",
            expression: ["Equal", "y", ["Sin", "x"]],
            symbols: {
              y: { label: "function value", unit: "dimensionless" },
              x: { label: "angle", unit: "radians" },
            },
            conditions: ["x in radians"],
            domain: [0, 2 * Math.PI],
            independent: "x",
          },
          basis,
        );
        add({ type: "mainline", coreId: "functions", basis });
        proposal.attention = { mode: "FOCUS", targets: ["sine"] };
        break;
    }
    proposal.dispositions.push({
      evidenceId: evidence.id,
      status: proposal.unresolved.some((u) => u.evidenceId === evidence.id)
        ? "unresolved"
        : proposal.operations.length > before
          ? "established"
          : "no-change",
    });
  }
  return proposal;
}
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const cancel = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}
/** Reviewed synthetic fixture oracle only; no keyword-driven production semantic inference. */
export const deterministicInterpreter =
  (timing = { live: 120, stage: 1100 }): Interpreter =>
  async (task, signal, firstUseful) => {
    await delay(task.lane === "Live" ? timing.live : timing.stage, signal);
    firstUseful();
    return fixtureProposal(task);
  };
export async function inject(session: Session, text: string, index: number) {
  const metadata = {
    transcript: text,
    start_time: index * 2,
    end_time: index * 2 + 1,
  };
  const observed = performance.now();
  await session.speech.receive(
    { message: "AddPartialTranscript", metadata },
    observed,
  );
  session.trace.mark("audio-to-partial", { index }, observed);
  session.speech.preflight();
  session.trace.mark("preflight", { index, speculation: "disabled" });
  await session.speech.receive(
    { message: "AddTranscript", metadata },
    observed,
  );
}

// The finite story oracle below uses the same provider-facing contracts as real inference.
// Its authored names are resolved through host slots; they are never runtime identity authority.

export function fixtureProposal(task: Task): LiveDecision | StageReview {
  const c = task.review ?? task.capture!;
  const coreNames: Record<string, string> = {},
    unitNames: Record<string, string> = {};
  for (const core of Object.values(task.state.cores))
    coreNames[core.id] =
      (core.label ?? core.title) === "Gas mixtures"
        ? "gases"
        : (core.label ?? core.title) === "Chemical equilibrium"
          ? "reactions"
          : "functions";
  for (const u of Object.values(task.state.units))
    unitNames[u.id] =
      u.meaning.kind === "quantity"
        ? u.meaning.symbols.p_i
          ? "pressure"
          : u.meaning.symbols.n_i
            ? "fraction"
            : "sine"
        : u.meaning.kind === "reaction"
          ? "ammonia"
          : u.meaning.kind === "relation"
            ? "comparison"
            : u.meaning.kind === "annotation"
              ? "fraction-share"
              : "mixture";
  const unit = (id: string) => unitNames[id] ?? id,
    core = (id: string) => coreNames[id] ?? id;
  const state: TeachingState = {
    ...structuredClone(task.state),
    currentCoreId: task.state.currentCoreId
      ? core(task.state.currentCoreId)
      : null,
    cores: Object.fromEntries(
      Object.values(task.state.cores).map((c) => [
        core(c.id),
        {
          ...c,
          title: c.label ?? c.title,
          id: core(c.id),
          unitIds: c.unitIds.map(unit),
        },
      ]),
    ),
    units: Object.fromEntries(
      Object.values(task.state.units).map((u) => [
        unit(u.id),
        {
          ...u,
          id: unit(u.id),
          coreId: core(u.coreId),
          requires: u.requires.map(unit),
          meaning:
            u.meaning.kind === "annotation"
              ? { ...u.meaning, target: unit(u.meaning.target) }
              : u.meaning.kind === "relation"
                ? { ...u.meaning, targets: u.meaning.targets.map(unit) }
                : u.meaning,
        },
      ]),
    ),
  };
  const mapped: Task = {
    ...task,
    state,
    obligations: task.obligations.map((o) => ({
      ...o,
      coreId: o.coreId ? core(o.coreId) : null,
    })),
  };
  const names: Record<string, string> = {};
  for (const [a, id] of Object.entries(c.cores))
    if (coreNames[id]) names[coreNames[id]] = a;
  for (const [a, id] of Object.entries(c.units))
    if (unitNames[id]) names[unitNames[id]] = a;
  let nc = 0,
    nu = 0;
  const ca = (id: string) =>
    names[id] ?? (names[id] = task.capture!.request.newCores[nc++]);
  const ua = (id: string) =>
    names[id] ?? (names[id] = c.request.newUnits[nu++]);
  const basis = (refs: Grounding[]) =>
    refs.flatMap((r) => {
      try {
        return fixtureBasis(task, r.quote);
      } catch {
        return [];
      }
    });
  const convert = (op: Operation): WireOperation[] => {
    const b = basis(op.basis);
    if (op.type === "core")
      return [{ type: "core", id: ca(op.id), label: op.title, basis: b }];
    if (op.type === "put") {
      const previous = mapped.state.units[op.id];
      if (previous)
        return authoredRevisions(
          ua(op.id),
          previous.meaning,
          op.meaning,
          ua,
          b,
        );
      return [
        {
          type: "put",
          id: ua(op.id),
          coreId: ca(op.coreId),
          dependencies: op.requires.map((id) => ({
            target: ua(id),
            kind: "IDENTITY" as const,
          })),
          meaning: projectMeaning(op.meaning, ua),
          basis: b,
        },
      ];
    }
    if (op.type === "invalidate") return [{ ...op, id: ua(op.id), basis: b }];
    if (op.type === "mainline")
      return [{ ...op, coreId: ca(op.coreId), basis: b }];
    return [
      {
        type: "cue",
        value: op.value
          ? { text: op.value.text, targets: op.value.targets.map(ua) }
          : null,
        basis: b,
      },
    ];
  };
  if (task.lane === "Stage") {
    const p = authoredLegacyDecision(mapped);
    return {
      scope: task.review!.namespace,
      results: task.review!.items.map((i) => {
        if (!p.resolve.includes(i.subjectId))
          return { item: i.id, outcome: "STILL_OPEN" as const };
        const operations = p.operations
          .flatMap(convert)
          .filter(
            (
              op,
            ): op is Extract<
              WireOperation,
              { type: "put" | "revise" | "invalidate" | "revalidate" }
            > =>
              ["put", "revise", "invalidate", "revalidate"].includes(op.type),
          );
        return {
          item: i.id,
          outcome: "RESOLVED" as const,
          operations,
          resolution: {
            referents: p.operations
              .filter((op) => op.type === "put")
              .flatMap((op) => op.requires)
              .filter((id) => Boolean(mapped.state.units[id]))
              .map(ua),
            targets: operations
              .filter((op) => op.type === "put")
              .map((op) => op.id),
            basis: p.operations.flatMap((op) => basis(op.basis)),
          },
        };
      }),
    };
  }
  const response: LiveDecision = {
    scope: task.capture!.namespace,
    groups: [],
    suffixStatus: "NONE",
    contextRequest: null,
    reviewRequests: [],
    attentionCandidate: null,
  };
  for (const e of task.evidence.filter(
    (e) =>
      (e.sequence > task.capture!.range.start.sequence ||
        (e.sequence === task.capture!.range.start.sequence &&
          e.text.length > task.capture!.range.start.offset)) &&
      e.sequence <= task.capture!.range.end.sequence,
  )) {
    const p = authoredLegacyDecision({ ...mapped, evidence: [e] });
    const through = Object.keys(task.capture!.boundaries).find((a) => {
      const b = task.capture!.boundaries[a];
      return b.evidenceId === e.id && b.offset === e.text.length;
    });
    if (!through) {
      response.suffixStatus = "WAIT_MORE_INPUT";
      break;
    }
    const operations = p.operations.flatMap(convert),
      u = p.unresolved[0];
    const blocked = operations.find(
      (op) =>
        ["revise", "invalidate", "revalidate"].includes(op.type) &&
        "id" in op &&
        !task.capture!.request.writableUnits.includes(op.id) &&
        !task.capture!.request.newUnits.includes(op.id),
    );
    if (blocked && "id" in blocked) {
      response.suffixStatus = "WAIT_MORE_INPUT";
      response.contextRequest = {
        query: unitNames[c.units[blocked.id]],
        purpose: "MODIFY",
        after: null,
      };
      break;
    }
    // Adjacent understood filler is one source group, regardless of final fragmentation.
    const previous = response.groups.at(-1);
    if (!u && !operations.length && previous?.outcome === "NO_CHANGE") {
      previous.throughBoundary = through;
      continue;
    }
    response.groups.push(
      u
        ? {
            throughBoundary: through,
            outcome: "CARRY",
            kind: "CONTEXT_REQUIRED",
            core: u.coreId ? ca(u.coreId) : null,
          }
        : operations.length
          ? {
              throughBoundary: through,
              outcome: "APPLY",
              operations,
              resolutions: [],
            }
          : { throughBoundary: through, outcome: "NO_CHANGE" },
    );
    mapped.state = reduceOperations(mapped.state, p.operations);
    if (p.attention)
      response.attentionCandidate = {
        ...p.attention,
        targets: p.attention.targets.map(ua),
      };
  }
  return response;
}
