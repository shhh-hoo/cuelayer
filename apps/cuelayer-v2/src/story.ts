import {
  reduceOperations,
  type Grounding,
  type Meaning,
  type Operation,
  type Proposal,
  type Task,
} from "./contract";
import type { Interpreter, Session } from "./session";
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
export function fixtureProposal(task: Task): Proposal {
  const proposal: Proposal = {
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
