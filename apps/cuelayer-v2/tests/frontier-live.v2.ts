import type { LiveDecision } from "../src/live-wire";
import { fixtureBasis, authoredRange } from "./frontier-fixtures";
import { afterEach, describe, it, expect, vi } from "vitest";
import { Session } from "../src/session";
import {
  emptyReplay,
  fold,
  reduceOperations,
  type Event,
  type Task,
} from "../src/contract";
import {
  ORIGIN,
  codePointBoundary,
  lexicalBoundaries,
  position,
  readable,
  sourcePieces,
  cursorAt,
} from "../src/source";
import { liveDecisionSchema } from "../src/live-wire";
import { liveRequest } from "../server/live";
import { expandBasis } from "../src/projection";
import {
  admit,
  openSession,
  waitDecision,
  fullGroup,
  establish,
  boundary,
  currentQuote,
  fast,
} from "./frontier-fixtures";
const sessions: Session[] = [];
async function open(...args: Parameters<typeof openSession>) {
  const s = await openSession(...args);
  sessions.push(s);
  return s;
}
afterEach(() => {
  for (const s of sessions) s.close();
  sessions.length = 0;
  vi.restoreAllMocks();
});
const manual = async (text: string) => {
  const s = await open();
  s.pause();
  await admit(s, text);
  return { s, t: s.capture("Live") };
};

describe("Gate 1: exact frontier and Live", () => {
  it.each(["A 😀 B", "𠮷野家 mole", "e\u0301 x", "🧪👩‍🔬 对比", "only if x > 0"])(
    "lexical cuts and source round trips preserve Unicode: %s",
    async (text) => {
      const { s } = await manual(text);
      for (const offset of lexicalBoundaries(text)) {
        expect(codePointBoundary(text, offset)).toBe(true);
        const c = cursorAt(s.replay.evidence, offset);
        expect(position(s.replay.evidence, c)).toBe(offset);
      }
    },
  );
  it("rejects the middle of a surrogate pair", async () => {
    const { s } = await manual("😀");
    expect(() =>
      position(s.replay.evidence, { evidenceId: "e0", sequence: 1, offset: 1 }),
    ).toThrow("invalid-source-cursor");
  });
  it("accounts a complete prefix inside a final and preserves unfinished suffix", async () => {
    const { s, t } = await manual(
      "An electrophile accepts an electron pair, while",
    );
    const end = "An electrophile accepts an electron pair,".length;
    const d = establish(t, "An electrophile accepts an electron pair,");
    d.groups[0].throughBoundary = boundary(s, t, {
      evidenceId: "e0",
      sequence: 1,
      offset: end,
    });
    d.suffixStatus = "WAIT_MORE_INPUT";
    await s.accept(t, d);
    expect(s.replay.accounted.offset).toBe(end);
    expect(s.window.livePendingCount).toBe(1);
    expect(s.window.unaccountedChars).toBe(6);
    expect(Object.keys(s.replay.unresolved)).toHaveLength(0);
  });
  it("WAIT persists no semantic event; later completion rereads the open tail", async () => {
    const seen: string[] = [];
    let s: Session;
    s = await open(async (t) => {
      const text = currentQuote(s, t);
      seen.push(text);
      return text.endsWith("collisions.")
        ? establish(t, text)
        : waitDecision(t);
    });
    await admit(s, "Activation energy is the minimum energy");
    await s.drainLive();
    expect(s.replay.accounted).toEqual(ORIGIN);
    expect(
      (await s.store.read(s.id)).filter((e) => e.type === "accepted"),
    ).toHaveLength(0);
    await admit(s, "required for successful collisions.");
    await s.drainLive();
    expect(seen.at(-1)).toBe(
      "Activation energy is the minimum energy required for successful collisions.",
    );
    expect(s.window.unaccountedChars).toBe(0);
  });
  it("identical WAIT snapshot does not dispatch again, even after resume/reload", async () => {
    const model = vi.fn(async (t) => waitDecision(t));
    const s = await open(model);
    await admit(s, "The minimum energy");
    await s.drainLive();
    s.resume();
    await new Promise((r) => setTimeout(r, 30));
    await s.drainLive();
    expect(model).toHaveBeenCalledTimes(1);
    s.close();
    const restored = await Session.open(s.id, model, s.store, fast);
    sessions.push(restored);
    await restored.drainLive();
    expect(model).toHaveBeenCalledTimes(1);
    expect(restored.window.unaccountedChars).toBe(18);
  });
  it.each([
    ["word", ["A", "mole", "fraction", "is", "a", "ratio."]],
    ["phrase", ["A mole fraction", "is a ratio."]],
    ["sentence", ["A mole fraction is a ratio."]],
  ])(
    "equivalent %s fragmentation converges with exact provenance",
    async (_label, parts) => {
      const s = await open();
      s.pause();
      for (const text of parts) await admit(s, text);
      const t = s.capture("Live");
      const text = currentQuote(s, t);
      expect(text).toBe("A mole fraction is a ratio.");
      await s.accept(
        t,
        establish(t, text, {
          kind: "statement",
          text: "A mole fraction is a ratio.",
        }),
      );
      const unit = Object.values(s.state.units)[0];
      expect(unit.meaning).toEqual({
        kind: "statement",
        text: "A mole fraction is a ratio.",
      });
      expect(unit.id.endsWith(":0")).toBe(true);
      expect(unit.basis.map((b) => b.quote)).toEqual(parts);
      expect(s.window.unaccountedChars).toBe(0);
    },
  );
  it("CARRY one interrupted range then APPLY later independent meaning; reload retains it", async () => {
    const s = await open();
    s.pause();
    await admit(s, "Activation energy is");
    await admit(s, "A mole fraction is a ratio.");
    const t = s.capture("Live");
    const d: LiveDecision = establish(t, "A mole fraction is a ratio.");
    d.groups.unshift({
      throughBoundary: boundary(s, t, {
        evidenceId: "e0",
        sequence: 1,
        offset: 20,
      }),
      outcome: "CARRY",
      kind: "INCOMPLETE_PROPOSITION",
      core: null,
    });
    await s.accept(t, d);
    expect(s.window.unaccountedChars).toBe(0);
    expect(s.window.carryChars).toBe(20);
    expect(Object.keys(s.replay.unresolved)).toHaveLength(1);
    const before = s.replay;
    s.close();
    const restored = await Session.open(
      s.id,
      async (t) => waitDecision(t),
      s.store,
      fast,
    );
    sessions.push(restored);
    expect(restored.replay).toEqual(before);
  });
  it("after reload Live resolves the same durable CARRY using its original range plus new source", async () => {
    const { s: original, t } = await manual("Activation energy is");
    await original.accept(t, fullGroup(t, "CARRY"));
    const carried = original.replay.unresolved;
    original.close();
    const s = await Session.open(
      original.id,
      async (t) => waitDecision(t),
      original.store,
      fast,
    );
    sessions.push(s);
    s.pause();
    expect(s.replay.unresolved).toEqual(carried);
    await admit(s, "the minimum energy required for successful collisions.");
    const next = s.capture("Live");
    const d = establish(
      next,
      "the minimum energy required for successful collisions.",
      {
        kind: "statement",
        text: "Activation energy is the minimum energy required for successful collisions.",
      },
    );
    for (const op of d.groups[0].operations)
      op.basis.push(
        ...fixtureBasis(
          next,
          "Activation energy is",
          next.capture!.request.obligations[0].source,
        ),
      );
    d.groups[0].resolutions = [
      {
        obligation: next.capture!.request.obligations[0].id,
        targets: d.attentionCandidate!.targets,
        basis: d.groups[0].operations.flatMap((op) => op.basis),
      },
    ];
    await s.accept(next, d);
    expect(s.replay.unresolved).toEqual({});
  });
  it("same-task correction establishes only the intended current meaning", async () => {
    const { s, t } = await manual(
      "The reaction is exothermic — sorry, endothermic.",
    );
    await s.accept(
      t,
      establish(t, currentQuote(s, t), {
        kind: "statement",
        text: "The reaction is endothermic.",
      }),
    );
    expect(Object.values(s.state.units).map((u) => u.meaning)).toEqual([
      { kind: "statement", text: "The reaction is endothermic." },
    ]);
  });
  it("later correction revises the same identity and keeps prior event provenance", async () => {
    const { s, t } = await manual("The reaction is exothermic.");
    await s.accept(t, establish(t, currentQuote(s, t)));
    const id = Object.keys(s.state.units)[0];
    await admit(s, "Correction: the reaction is endothermic.");
    const next = s.capture("Live");
    await s.accept(
      next,
      establish(next, currentQuote(s, next), {
        kind: "statement",
        text: "The reaction is endothermic.",
      }),
    );
    expect(Object.keys(s.state.units)).toEqual([id]);
    expect(s.state.units[id].version).toBe(2);
    expect(
      (await s.store.read(s.id)).filter((e) => e.type === "accepted"),
    ).toHaveLength(2);
  });
  it.each(["only if", "unless", "not"])(
    "retains truth-critical scope: %s",
    async (qualifier) => {
      const text = `The process occurs ${qualifier} the condition holds.`;
      const { s, t } = await manual(text);
      await s.accept(t, establish(t, text));
      expect(Object.values(s.state.units)[0].meaning).toEqual({
        kind: "statement",
        text,
      });
    },
  );
  it("same text with distinct evidence remains distinct; understood administration may NO_CHANGE", async () => {
    const s = await open(async (t) => fullGroup(t));
    await admit(s, "Please open your books.");
    await admit(s, "Please open your books.");
    await s.drainLive();
    expect(s.replay.evidence).toHaveLength(2);
    expect(s.window.unaccountedChars).toBe(0);
    expect(s.state.revision).toBe(0);
    expect(s.attention).toBeNull();
  });
  it("range pointers disambiguate repeated text without deduplicating source", async () => {
    const s = await open();
    s.pause();
    const text = "A narrator tells the story.";
    await admit(s, text);
    await admit(s, text);
    const t = s.capture("Live");
    const d: LiveDecision = establish(t, text);
    const middle = cursorAt(s.replay.evidence, text.length);
    d.groups[0].throughBoundary = boundary(s, t, middle);
    d.groups.push(fullGroup(t).groups[0]);
    await s.accept(t, d);
    expect(s.window.unaccountedChars).toBe(0);
    expect(
      Object.values(s.state.units)[0].basis.map((b) => b.evidenceId),
    ).toEqual(["e0"]);
    const later = expandBasis(s.replay.evidence, t.capture!.range, text, {
      start: middle,
      end: t.capture!.range.end,
    });
    expect(later.map((b) => b.evidenceId)).toEqual(["e1"]);
    expect(later[0].range.start).toEqual(middle);
  });
  it("quote matching cannot escape the processing group", async () => {
    const { s, t } = await manual("First fact. Second fact.");
    const d = establish(t, "Second fact.");
    d.groups[0].throughBoundary = boundary(
      s,
      t,
      cursorAt(s.replay.evidence, 11),
    );
    d.suffixStatus = "WAIT_MORE_INPUT";
    await expect(s.accept(t, d)).rejects.toThrow(
      "grounding-outside-processing-group",
    );
    expect(s.replay.accounted).toEqual(ORIGIN);
  });
  it("unknown/cross-task aliases and schema failures account zero source", async () => {
    const { s, t } = await manual("A mole fraction is a ratio.");
    const second = s.capture("Live");
    for (const raw of [
      {
        ...fullGroup(t),
        groups: [{ ...fullGroup(t).groups[0], throughBoundary: "bBAD" }],
      },
      fullGroup(second),
      { ...fullGroup(t), accountThrough: 123 },
    ])
      await expect(s.accept(t, raw)).rejects.toThrow();
    expect(s.window.unaccountedChars).toBe(27);
  });
  it("invalid semantic references account zero source", async () => {
    const { s, t } = await manual("A depends on B.");
    const d = establish(t, currentQuote(s, t));
    const op = d.groups[0].operations.at(-1)!;
    if (op.type === "put")
      op.dependencies = [
        { target: t.capture!.request.newUnits[1], kind: "VALUE" },
      ];
    await expect(s.accept(t, d)).rejects.toThrow("invalid-semantic-dependency");
    expect(s.state.revision).toBe(0);
  });
  it("redundant semantic put cannot manufacture APPLY", async () => {
    const { s, t } = await manual("A mole fraction is a ratio.");
    await s.accept(t, establish(t, currentQuote(s, t)));
    await admit(s, "A mole fraction is a ratio.");
    const next = s.capture("Live");
    await expect(
      s.accept(next, establish(next, currentQuote(s, next))),
    ).rejects.toThrow("semantic-no-op");
    expect(Object.values(s.state.units)[0].version).toBe(1);
    expect(s.window.livePendingCount).toBe(1);
  });
  it("lost durable acknowledgement is reconciled without duplicate accounting", async () => {
    const { s, t } = await manual("Please open your books.");
    const original = s.store.append.bind(s.store);
    vi.spyOn(s.store, "append").mockImplementation(async (e, n) => {
      await original(e, n);
      if (e.type === "accepted") throw new Error("ack-lost");
    });
    await s.accept(t, fullGroup(t));
    await s.accept(t, fullGroup(t));
    expect(
      (await s.store.read(s.id)).filter((e) => e.type === "accepted"),
    ).toHaveLength(1);
    expect(s.replay).toEqual(
      (await s.store.read(s.id)).reduce(fold, emptyReplay()),
    );
  });
  it("capture close wakes WAIT and model-grounded incomplete CARRY allows sealing", async () => {
    let s: Session;
    s = await open(async (t) =>
      t.capture!.request.mode === "FINALIZE"
        ? fullGroup(t, "CARRY")
        : waitDecision(t),
    );
    await admit(s, "The minimum energy is");
    await s.drainLive();
    await s.finish();
    expect(s.replay.ended).toBe(true);
    expect(s.window.carryChars).toBe(21);
  });
  it("failed final drain remains unsealed/recoverable", async () => {
    const s = await open();
    await admit(s, "The minimum energy is");
    await s.drainLive();
    await expect(s.finish()).rejects.toThrow("final-drain-incomplete");
    expect(s.replay.ended).toBe(false);
  });
  it("OUTPUT_CAPACITY prefix advances A and next bounded task runs without new speech", async () => {
    let calls = 0,
      s: Session;
    s = await open(async (t) => {
      calls++;
      const d = fullGroup(t);
      if (calls === 1) {
        d.groups[0].throughBoundary = boundary(s, t, {
          evidenceId: "e0",
          sequence: 1,
          offset: 6,
        });
        d.suffixStatus = "OUTPUT_CAPACITY";
      }
      return d;
    });
    await admit(s, "Hello. Please open your books.");
    await s.drainLive();
    expect(calls).toBe(2);
    expect(s.window.unaccountedChars).toBe(0);
  });
  it("zero-progress OUTPUT_CAPACITY blocks without a hot loop", async () => {
    const model = vi.fn(async (t) => ({
      ...waitDecision(t),
      suffixStatus: "OUTPUT_CAPACITY" as const,
    }));
    const s = await open(model);
    await admit(s, "Hello.");
    await expect(s.drainLive()).rejects.toThrow(
      "output-capacity-zero-progress",
    );
    s.resume();
    await new Promise((r) => setTimeout(r, 30));
    expect(model).toHaveBeenCalledTimes(1);
    expect(s.window.unaccountedChars).toBe(6);
  });
  it("draining a resumed failed snapshot rejects without redispatch or a hot loop", async () => {
    const model = vi.fn(async () => null);
    const s = await open(model);
    await admit(s, "Please continue.");
    await vi.waitFor(() => expect(s.error).not.toBeNull());
    s.resume();
    await expect(s.drainLive()).rejects.toThrow();
    expect(model).toHaveBeenCalledTimes(1);
    expect(s.window.unaccountedChars).toBeGreaterThan(0);
  });
  it("capture close during Live waits for the new generation's final drain", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const modes: string[] = [];
    const s = await open(async (t) => {
      modes.push(t.capture!.request.mode);
      if (modes.length === 1) await held;
      return fullGroup(t);
    });
    await admit(s, "Please turn the page.");
    await vi.waitFor(() => expect(modes).toEqual(["CONTINUOUS"]));
    const finished = s.finish();
    await vi.waitFor(() => expect(s.replay.captureClosed).toBe(true));
    release();
    await expect(finished).resolves.toBeUndefined();
    expect(modes).toEqual(["CONTINUOUS", "FINALIZE"]);
    expect(s.replay.ended).toBe(true);
    expect(s.window.unaccountedChars).toBe(0);
    expect(s.window.activeLive).toBeNull();
  });
  it("new finals persist during slow Live; next capture has more than four finals", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const sizes: number[] = [];
    const s = await open(async (t) => {
      sizes.push(
        new Set(
          sourcePieces(s.replay.evidence, t.capture!.range).map(
            (p) => p.evidenceId,
          ),
        ).size,
      );
      if (sizes.length === 1) await hold;
      return fullGroup(t);
    });
    await admit(s, "Hello.");
    await vi.waitFor(() => expect(sizes).toHaveLength(1));
    for (let i = 0; i < 20; i++) await admit(s, "Please continue.");
    expect(s.replay.recorded.sequence).toBe(21);
    expect(s.replay.accounted).toEqual(ORIGIN);
    release();
    await s.drainLive();
    expect(sizes[1]).toBe(20);
    expect(s.window.unaccountedChars).toBe(0);
  });
  it("strict schema has no unsupported open object or optional fields; no prompt schema duplication", async () => {
    const { t } = await manual("Hello.");
    const r = await liveRequest(t.capture!.request);
    expect(r.text.format.strict).toBe(true);
    expect(r.input[0].content).not.toContain('"properties"');
    const check = (o: any) => {
      if (o && typeof o === "object") {
        expect(o).not.toHaveProperty("oneOf");
        expect(o).not.toHaveProperty("allOf");
        if (o.$ref) {
          expect(o.$ref.startsWith("#/")).toBe(true);
          expect(
            o.$ref
              .slice(2)
              .split("/")
              .reduce((v: any, k: string) => v?.[k], r.text.format.schema),
          ).toBeDefined();
        }
        if (o.type === "object") {
          expect(o.additionalProperties).toBe(false);
          expect(o.required?.sort()).toEqual(Object.keys(o.properties).sort());
        }
        for (const x of Object.values(o)) check(x);
      }
    };
    check(r.text.format.schema);
    const operations = (r.text.format.schema as any).properties.groups.items
      .anyOf[0].properties.operations.items;
    expect(operations.anyOf).toHaveLength(7);
    expect(r.text.format.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(r.text.format.schema).not.toHaveProperty("anyOf");
    expect(r.text.format.schema).not.toHaveProperty("$ref");
    expect(operations.anyOf[2].properties.meaning.anyOf).toHaveLength(4);
    expect(operations.anyOf[2].properties).not.toHaveProperty("fieldBasis");
    expect(operations.anyOf[1].required).toContain("fieldBasis");
    expect(operations.anyOf[1].properties.meaning.properties.kind.const).toBe(
      "quantity",
    );
  });
  it("LEGACY_UNSPECIFIED and renderer failures cannot become new CARRY kinds", async () => {
    const { t } = await manual("Hello.");
    for (const kind of ["LEGACY_UNSPECIFIED", "REPRESENTATION_UNSUPPORTED"]) {
      const d = fullGroup(t, "CARRY");
      (d.groups[0] as any).kind = kind;
      expect(liveDecisionSchema.safeParse(d).success).toBe(false);
    }
  });
  it("legacy event reducer preserves old revision increments and reconstructs whole-evidence frontier", () => {
    const text = "Old teaching.";
    const e: Event = {
      schema: "cuelayer-v2-event-1",
      sessionId: "old",
      id: "old:1",
      sequence: 1,
      at: 0,
      type: "evidence",
      evidence: {
        id: "e",
        run: "r",
        source: "0",
        text,
        start: 0,
        end: 1,
        receivedAt: 0,
        audioObservedAt: null,
        sequence: 1,
        stability: "COMMITTED",
      },
    };
    let r = fold(emptyReplay(), e);
    r = fold(r, {
      ...e,
      id: "old:2",
      sequence: 2,
      type: "accepted",
      accepted: {
        taskId: "t",
        lane: "Live",
        dependencies: {},
        operations: [],
        dispositions: [{ evidenceId: "e", status: "unresolved" }],
        unresolved: [
          {
            id: "o",
            evidenceIds: ["e"],
            phrase: text,
            coreId: null,
            createdAt: 0,
          },
        ],
        resolved: [],
        reviewed: [],
      },
    });
    expect(r.accounted).toEqual(r.recorded);
    expect(r.unresolved.o.kind).toBe("LEGACY_UNSPECIFIED");
  });
});

it("valid actual Speechmatics word alignment is used; mismatched tokens fall back without reconstructing source", async () => {
  const { providerAlignment } = await import("../src/adapters/speech");
  const { evidenceBoundaries } = await import("../src/source");
  const message = {
    message: "AddTranscript" as const,
    metadata: { transcript: "A 😀 test", start_time: 0, end_time: 2 },
    results: [
      {
        type: "word",
        start_time: 0,
        end_time: 0.3,
        alternatives: [{ content: "A" }],
      },
      {
        type: "word",
        start_time: 0.3,
        end_time: 1,
        alternatives: [{ content: "😀" }],
      },
      {
        type: "word",
        start_time: 1,
        end_time: 2,
        alternatives: [{ content: "test" }],
      },
    ],
  };
  const aligned = providerAlignment(message);
  expect(aligned.alignment?.boundaries).toEqual([0, 1, 2, 4, 5, 9]);
  const { s } = await manual(message.metadata.transcript);
  expect(evidenceBoundaries({ ...s.replay.evidence[0], ...aligned })).toEqual([
    0, 1, 2, 4, 5, 9,
  ]);
  expect(
    providerAlignment({
      ...message,
      results: [
        { ...message.results[0], alternatives: [{ content: "wrong" }] },
      ],
    }),
  ).toEqual({});
});
it("quantitative object key order cannot manufacture a semantic revision", async () => {
  const { s, t } = await manual("The area is length times width.");
  const meaning = {
    kind: "quantity" as const,
    expression: ["Equal", "A", ["Multiply", "l", "w"]] as any,
    symbols: {
      A: { label: "area", unit: "m²" },
      l: { label: "length", unit: "m" },
      w: { label: "width", unit: "m" },
    },
    conditions: ["rectangle"],
  };
  await s.accept(t, establish(t, currentQuote(s, t), meaning));
  await admit(s, "The area is length times width.");
  const next = s.capture("Live");
  await expect(
    s.accept(
      next,
      establish(next, currentQuote(s, next), {
        ...meaning,
        symbols: {
          w: meaning.symbols.w,
          l: meaning.symbols.l,
          A: meaning.symbols.A,
        },
      }),
    ),
  ).rejects.toThrow("semantic-no-op");
});
it("minimal semantic closure that cannot fit is explicit context blocked with zero consumption", async () => {
  const { captureLive, DEFAULT_BUDGET } = await import("../src/projection");
  const { s, t } = await manual(
    "The process occurs only if the condition holds.",
  );
  await s.accept(t, establish(t, currentQuote(s, t)));
  await admit(s, "Continue.");
  expect(() =>
    captureLive(s.replay, s.id, "tiny", 0, {
      ...DEFAULT_BUDGET,
      maxRequestBytes: 32,
    }),
  ).toThrow("context-blocked");
  expect(s.window.unaccountedChars).toBe(9);
});
it("WAIT after a progressed prefix cannot suppress newly admitted source outside its captured task", async () => {
  let release!: () => void,
    calls = 0,
    s: Session;
  const held = new Promise<void>((r) => (release = r));
  s = await open(async (t) => {
    if (++calls === 1) {
      await held;
      const d = fullGroup(t);
      d.groups[0].throughBoundary = boundary(s, t, {
        evidenceId: "e0",
        sequence: 1,
        offset: 6,
      });
      d.suffixStatus = "WAIT_MORE_INPUT";
      return d;
    }
    return fullGroup(t);
  });
  await admit(s, "Hello. Please");
  await vi.waitFor(() => expect(calls).toBe(1));
  await admit(s, "continue.");
  release();
  await s.drainLive();
  expect(calls).toBe(2);
  expect(s.window.unaccountedChars).toBe(0);
});

it("Live cannot resolve a carry using a different range in the same provider final", async () => {
  const { s, t } = await manual(
    "Activation energy is. A mole fraction is a ratio.",
  );
  const d: LiveDecision = establish(t, "A mole fraction is a ratio.");
  d.groups.unshift({
    throughBoundary: boundary(s, t, {
      evidenceId: "e0",
      sequence: 1,
      offset: 22,
    }),
    outcome: "CARRY",
    kind: "INCOMPLETE_PROPOSITION",
    core: null,
  });
  await s.accept(t, d);
  await admit(s, "The fraction describes relative amount.");
  const next = s.capture("Live"),
    reply = establish(next, currentQuote(s, next));
  const context = next.capture!.request.context.find(
    (c) => c.role === "CONTEXT_ONLY",
  )!;
  for (const op of reply.groups[0].operations)
    op.basis.push(
      ...fixtureBasis(next, "A mole fraction is a ratio.", context.source),
    );
  reply.groups[0].resolutions = [
    {
      obligation: next.capture!.request.obligations[0].id,
      targets: reply.attentionCandidate!.targets,
      basis: reply.groups[0].operations.flatMap((op) => op.basis),
    },
  ];
  await expect(s.accept(next, reply)).rejects.toThrow("ungrounded-resolution");
  expect(Object.keys(s.replay.unresolved)).toHaveLength(1);
  expect(s.window.unaccountedChars).toBe(
    "The fraction describes relative amount.".length,
  );
});
it("recovery rates count new source progress during the current observation", async () => {
  const { s, t } = await manual("Please turn the page.");
  await s.accept(t, fullGroup(t));
  s.close();
  const restored = await Session.open(
    s.id,
    async (t) => waitDecision(t),
    s.store,
    fast,
  );
  sessions.push(restored);
  expect(restored.window.recordedCharsPerSecond).toBe(0);
  expect(restored.window.accountedCharsPerSecond).toBe(0);
});

it.each(["word", "phrase", "sentence", "sentence-plus-tail"])(
  "%s fragmentation preserves quantitative conditions, dependencies, identities and source provenance",
  async (fragmentation) => {
    const first =
      "For an ideal gas mixture, partial pressure equals mole fraction times total pressure.";
    const second =
      "The relation holds only if the gas mixture is ideal; pressures use pascals and mole fraction is dimensionless.";
    const text = `${first} ${second}`;
    const parts =
      fragmentation === "word"
        ? text.split(" ")
        : fragmentation === "phrase"
          ? [
              "For an ideal gas mixture,",
              "partial pressure equals mole fraction",
              "times total pressure.",
              "The relation holds only if the gas mixture is ideal;",
              "pressures use pascals and mole fraction is dimensionless.",
            ]
          : fragmentation === "sentence"
            ? [first, second]
            : [
                `${first} The relation holds only if`,
                "the gas mixture is ideal; pressures use pascals and mole fraction is dimensionless.",
              ];
    const s = await open();
    s.pause();
    for (const part of parts) await admit(s, part);
    const t = s.capture("Live"),
      req = t.capture!.request;
    expect(currentQuote(s, t)).toBe(text);
    const meaning = {
      kind: "quantity" as const,
      expression: ["Equal", "p", ["Multiply", "x", "P"]] as [
        "Equal",
        string,
        ["Multiply", string, string],
      ],
      symbols: {
        p: { label: "partial pressure", unit: "Pa" },
        x: { label: "mole fraction", unit: "1" },
        P: { label: "total pressure", unit: "Pa" },
      },
      conditions: ["only if the gas mixture is ideal"],
    };
    const d = establish(t, text, meaning);
    d.groups[0].operations.push({
      type: "put",
      id: req.newUnits[1],
      coreId: req.newCores[0],
      meaning: {
        kind: "annotation",
        text: "The relation holds only if the gas mixture is ideal.",
        target: req.newUnits[0],
      },
      dependencies: [{ target: req.newUnits[0], kind: "IDENTITY" }],
      basis: fixtureBasis(t, text),
    });
    await s.accept(t, d);
    const [quantity, condition] = Object.values(s.state.units);
    expect(quantity.id.endsWith(":0")).toBe(true);
    expect(condition.id.endsWith(":1")).toBe(true);
    expect(quantity.meaning).toEqual(meaning);
    expect(condition.meaning).toEqual({
      kind: "annotation",
      text: "The relation holds only if the gas mixture is ideal.",
      target: quantity.id,
    });
    expect(condition.requires).toEqual([quantity.id]);
    expect(quantity.basis.map((b) => b.quote)).toEqual(parts);
    expect(condition.basis.map((b) => b.quote)).toEqual(parts);
    expect(s.window.unaccountedChars).toBe(0);
    expect(s.replay.unresolved).toEqual({});
  },
);
