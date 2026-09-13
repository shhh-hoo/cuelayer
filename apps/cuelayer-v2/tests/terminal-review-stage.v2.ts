import { expect, it } from "vitest";
import {
  emptyReplay,
  fold,
  type Accepted,
  type Event,
  type Replay,
} from "../src/contract";
import { ORIGIN, position, readable } from "../src/source";
import { captureStage, validateStage, reviewCandidates } from "../src/stage";
import { getSourceSubject, terminalRisk } from "../src/terminal-review";

function accepted(taskId: string, patch: Partial<Accepted> = {}): Accepted {
  return {
    taskId,
    lane: "Live",
    dependencies: {},
    operations: [],
    dispositions: [],
    unresolved: [],
    resolved: [],
    reviewed: [],
    ...patch,
  };
}
function fixture(original = "The partial pressure is...") {
  let replay = emptyReplay();
  const events: Event[] = [];
  const append = (payload: Partial<Event>) => {
    const event = {
      schema: "cuelayer-v2-event-3",
      sessionId: "source-review",
      id: `event-${replay.sequence + 1}`,
      sequence: replay.sequence + 1,
      at: replay.sequence,
      ...payload,
    } as Event;
    replay = fold(replay, event);
    events.push(event);
    return replay;
  };
  const admit = (text: string) => {
    const i = replay.evidence.length;
    return append({
      type: "evidence",
      evidence: {
        id: `e${i}`,
        run: "run",
        source: String(i),
        text,
        start: i,
        end: i + 1,
        receivedAt: i,
        audioObservedAt: null,
        sequence: i + 1,
        stability: "COMMITTED",
      },
    });
  };
  const account = (flag = false) => {
    const range = { start: replay.accounted, end: replay.recorded };
    return append({
      type: "accepted",
      accepted: accepted(`account-${replay.sequence}`, {
        processing: {
          version: "v2-source-processing-1",
          groups: [{ range, outcome: "NO_CHANGE" }],
          suffixStatus: "NONE",
          inspectionKey: `source-${replay.sequence}`,
        },
        ...(flag
          ? {
              reviewRequests: [
                {
                  id: "risk",
                  kind: "SOURCE_NO_CHANGE",
                  version: 1,
                  range,
                  coreId: null,
                  purpose: "Classify a structurally unfinished source ending",
                  createdAt: 0,
                  risk: {
                    version: "v2-terminal-risk-1",
                    reasons: terminalRisk(readable(replay.evidence, range)),
                  },
                },
              ],
            }
          : {}),
      }),
    });
  };
  admit(original);
  account(true);
  return {
    get replay() {
      return replay;
    },
    events,
    append,
    admit,
    account,
  };
}
function sourceTask(replay: Replay, nonce = "stage") {
  const task = captureStage(replay, "source-review", nonce, 0, "risk");
  if (!task) throw new Error("missing-stage-fixture");
  return task;
}
function result(task: ReturnType<typeof sourceTask>, outcome: string) {
  return { scope: task.review!.namespace, results: [{ item: "r0", outcome }] };
}

it("uses structural terminal flags without promoting them to semantic conclusions", () => {
  expect(terminalRisk("P is...")).toEqual(["ELLIPSIS", "TRAILING_COPULA"]);
  expect(terminalRisk("First A and")).toEqual(["TRAILING_CONNECTOR"]);
  expect(terminalRisk("Draw (A + B")).toEqual(["UNCLOSED_DELIMITER"]);
  expect(terminalRisk("Class dismissed.")).toEqual([]);
  expect(terminalRisk("A mole fraction is a ratio.")).toEqual([]);
  expect(terminalRisk("Draw (A + B).")).toEqual([]);
  expect(terminalRisk("The ratio is... Please turn to the next page.")).toEqual(
    ["ELLIPSIS", "TRAILING_COPULA"],
  );
  expect(terminalRisk("The ratio is. Please turn to the next page.")).toEqual([
    "TRAILING_COPULA",
  ]);
});

it("source-only Stage has no knowledge mutation or creation capability", () => {
  const f = fixture(),
    task = sourceTask(f.replay);
  expect(task.review!.request.items[0].kind).toBe("SOURCE_NO_CHANGE");
  expect(task.review!.request.units).toEqual([]);
  expect(task.review!.request.newUnits).toEqual([]);
  expect(task.writeScope).toEqual({
    units: [],
    createIn: [],
    labels: [],
    mainline: false,
    cue: false,
  });
  expect(() =>
    validateStage(f.replay, task, {
      scope: task.review!.namespace,
      results: [
        { item: "r0", outcome: "RESOLVED", operations: [], resolution: null },
      ],
    }),
  ).toThrow("source-review-cannot-write-knowledge");
});

it("retains the entire mixed NO_CHANGE group when an unfinished marker precedes administration", () => {
  const text = "The ratio we will use next is... Please turn to the next page.";
  const f = fixture(text),
    task = sourceTask(f.replay);
  expect(readable(f.replay.evidence, f.replay.reviewConcerns.risk.range)).toBe(
    text,
  );
  expect(task.review!.request.items[0].phrase).toBe(text);
  expect(f.replay.reviewConcerns.risk.range).toEqual({
    start: ORIGIN,
    end: f.replay.recorded,
  });
});

it("confirms NO_CHANGE only at the current fully covered recorded horizon", () => {
  const f = fixture(),
    task = sourceTask(f.replay);
  const before = structuredClone(f.replay);
  const output = validateStage(
    f.replay,
    task,
    result(task, "CONFIRMED_NO_CHANGE"),
  );
  f.append({ type: "accepted", accepted: output.accepted });
  expect(f.replay.reviewConcerns.risk).toBeUndefined();
  expect(f.replay.state).toEqual(before.state);
  expect(f.replay.accounted).toEqual(before.accounted);
  expect(f.replay.consumed).toEqual(before.consumed);
  expect(f.events.reduce(fold, emptyReplay())).toEqual(f.replay);
});

it("rejects a confirmation when clarification arrived after capture, including replay of that stale record", () => {
  const f = fixture(),
    task = sourceTask(f.replay);
  const stale = validateStage(
    f.replay,
    task,
    result(task, "CONFIRMED_NO_CHANGE"),
  );
  f.admit("equal to mole fraction times total pressure.");
  expect(() =>
    validateStage(f.replay, task, result(task, "CONFIRMED_NO_CHANGE")),
  ).toThrow("source-review-horizon-changed");
  expect(() =>
    f.append({ type: "accepted", accepted: stale.accepted }),
  ).toThrow("source-review-horizon-changed");
  expect(f.replay.reviewConcerns.risk).toBeDefined();
});

it("reviews bounded contiguous accounted follow-up pages rather than the newest tail", () => {
  const f = fixture();
  for (let i = 0; i < 90; i++)
    f.admit(`Follow-up sentence ${i} has exactly preserved source evidence.`);
  f.account();
  const first = sourceTask(f.replay),
    c = first.review!;
  expect(c.sources.s1.start).toEqual(f.replay.reviewConcerns.risk.range.end);
  expect(readable(f.replay.evidence, c.sources.s1)).toContain("sentence 0");
  expect(readable(f.replay.evidence, c.sources.s1)).not.toContain(
    "sentence 89",
  );
  expect(
    position(f.replay.evidence, c.sources.s1.end) -
      position(f.replay.evidence, c.sources.s1.start),
  ).toBeLessThanOrEqual(3200);
  expect(c.request.omitted.followingSource).toBe(true);
  expect(() =>
    validateStage(f.replay, first, result(first, "CONFIRMED_NO_CHANGE")),
  ).toThrow("source-review-horizon-changed");
  const reviewed = validateStage(f.replay, first, result(first, "STILL_OPEN"));
  f.append({ type: "accepted", accepted: reviewed.accepted });
  expect(f.replay.reviewConcerns.risk.cursor).toEqual(c.sources.s1.end);
  const second = sourceTask(f.replay, "next-page");
  expect(second.review!.sources.s1.start).toEqual(c.sources.s1.end);
  expect(second.review!.sources.s0).toEqual(c.sources.s0);
  expect(f.events.reduce(fold, emptyReplay())).toEqual(f.replay);
});

it("CARRY promotes the original source identity and range once, leaving Live coverage unchanged", () => {
  const f = fixture();
  f.admit("The continuation needs its semantic relation interpreted.");
  f.account();
  const task = sourceTask(f.replay),
    original = structuredClone(f.replay);
  const output = validateStage(f.replay, task, {
    scope: task.review!.namespace,
    results: [
      {
        item: "r0",
        outcome: "CARRY",
        kind: "INCOMPLETE_PROPOSITION",
        core: null,
      },
    ],
  });
  f.append({ type: "accepted", accepted: output.accepted });
  expect(f.replay.reviewConcerns.risk).toBeUndefined();
  expect(f.replay.unresolved.risk).toMatchObject({
    id: "risk",
    version: 2,
    kind: "INCOMPLETE_PROPOSITION",
    coreId: null,
    range: original.reviewConcerns.risk.range,
    sourceReview: {
      version: "v2-terminal-review-1",
      cursor: original.reviewConcerns.risk.range.end,
    },
  });
  expect(f.replay.accounted).toEqual(original.accounted);
  expect(f.replay.consumed).toEqual(original.consumed);
  expect(f.replay.state).toEqual(original.state);
  expect(getSourceSubject(f.replay, "risk")).toBe(f.replay.unresolved.risk);
  expect(reviewCandidates(f.replay)).toEqual([]);
  expect(() =>
    validateStage(f.replay, task, result(task, "READY_FOR_LIVE")),
  ).toThrow("stale-dependency:review/risk");
});

it("READY_FOR_LIVE stays an unclassified source concern and cannot be dispatched repeatedly to Stage", () => {
  const f = fixture(),
    task = sourceTask(f.replay);
  const output = validateStage(f.replay, task, result(task, "READY_FOR_LIVE"));
  f.append({ type: "accepted", accepted: output.accepted });
  expect(f.replay.reviewConcerns.risk).toMatchObject({
    kind: "SOURCE_NO_CHANGE",
    version: 2,
    readyForLive: true,
    cursor: f.replay.reviewConcerns.risk.range.end,
  });
  expect(f.replay.unresolved).toEqual({});
  expect(reviewCandidates(f.replay)).toEqual([]);
  expect(getSourceSubject(f.replay, "risk")).toBe(f.replay.reviewConcerns.risk);
});

it("recovery CARRY persists its inspection identity, promotes once and never consumes evidence again", () => {
  const f = fixture();
  f.admit("The continuation remains ambiguous.");
  f.account();
  const before = structuredClone(f.replay);
  f.append({
    type: "accepted",
    accepted: accepted("recovery", {
      recovery: {
        version: "v2-live-source-review-1",
        subjectId: "risk",
        subjectVersion: 1,
        range: before.reviewConcerns.risk.range,
        inspectionKey: "recovery-key",
        outcome: "CARRY",
        through: before.accounted,
        carry: { kind: "UNRESOLVED_REFERENCE", coreId: null },
      },
    }),
  });
  expect(f.replay.unresolved.risk.version).toBe(2);
  expect(f.replay.unresolved.risk.sourceReview?.cursor).toEqual(
    before.accounted,
  );
  expect(f.replay.inspections["recovery-key"]).toBe("WAIT_MORE_INPUT");
  expect(f.replay.accounted).toEqual(before.accounted);
  expect(f.replay.consumed).toEqual(before.consumed);
  expect(f.events.reduce(fold, emptyReplay())).toEqual(f.replay);
});

it("fold rejects unbound recovery versions and fabricated NO_CHANGE risk provenance", () => {
  const f = fixture(),
    subject = f.replay.reviewConcerns.risk;
  expect(() =>
    f.append({
      type: "accepted",
      accepted: accepted("stale", {
        recovery: {
          version: "v2-live-source-review-1",
          subjectId: "risk",
          subjectVersion: 99,
          range: subject.range,
          inspectionKey: "bad",
          outcome: "NO_CHANGE",
          through: subject.range.end,
        },
      }),
    }),
  ).toThrow("invalid-source-review-subject");
  f.admit("An ordinary complete sentence.");
  expect(() => f.account(true)).toThrow("duplicate-review-concern");
  const start = f.replay.accounted,
    end = f.replay.recorded;
  expect(() =>
    f.append({
      type: "accepted",
      accepted: accepted("forged-risk", {
        processing: {
          version: "v2-source-processing-1",
          groups: [{ range: { start, end }, outcome: "NO_CHANGE" }],
          suffixStatus: "NONE",
          inspectionKey: "forged",
        },
        reviewRequests: [{ ...subject, id: "forged", range: { start, end } }],
      }),
    }),
  ).toThrow("invalid-source-review-concern");
});

it("fold cannot apply a recovery NO_CHANGE past unseen continuation or after capture closes", () => {
  const f = fixture(),
    subject = f.replay.reviewConcerns.risk;
  const recovery = accepted("closed-review", {
    recovery: {
      version: "v2-live-source-review-1",
      subjectId: subject.id,
      subjectVersion: subject.version,
      range: subject.range,
      inspectionKey: "closed-review",
      outcome: "NO_CHANGE",
      through: f.replay.recorded,
    },
  });
  f.admit("The intended relation follows in this newly admitted continuation.");
  expect(() => f.append({ type: "accepted", accepted: recovery })).toThrow(
    "source-review-horizon-changed",
  );
  f.account();
  recovery.recovery!.through = f.replay.recorded;
  f.append({ type: "capture-closed", generation: f.replay.generation + 1 });
  expect(() => f.append({ type: "accepted", accepted: recovery })).toThrow(
    "invalid-source-recovery-event",
  );
  expect(f.replay.reviewConcerns.risk).toBeDefined();
});

it("historical unflagged NO_CHANGE events keep their original replay meaning", () => {
  const f = fixture();
  const oldEvents = f.events.map((event) =>
    event.type === "accepted"
      ? { ...event, accepted: { ...event.accepted, reviewRequests: [] } }
      : event,
  );
  const old = oldEvents.reduce(fold, emptyReplay());
  expect(old.reviewConcerns).toEqual({});
  expect(old.unresolved).toEqual({});
  expect(old.accounted).toEqual(f.replay.accounted);
  expect(old.consumed).toEqual(f.replay.consumed);
  expect(old.accounted).not.toEqual(ORIGIN);
});
