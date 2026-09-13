import { expect, it, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { Session } from "../src/session";
import { EventStore } from "../src/adapters/storage";
import Dexie from "dexie";
import { delay } from "../src/story";
import { position } from "../src/source";
import type { Event } from "../src/contract";
import { workload, workloadProfile as profile } from "./workload-fixture";
import { interpretWorkload } from "./workload-interpreter";
import { compileStageDeclarations } from "../src/stage-wire";

/** Zero virtual-time append port: the browser test separately uses real IndexedDB transactions. */
class ClockStore extends EventStore {
  private log: Event[] = [];
  override read(id: string) {
    return Dexie.Promise.resolve(
      structuredClone(this.log.filter((e) => e.sessionId === id)),
    );
  }
  override async append(event: Event, expected: number) {
    const events = this.log.filter((e) => e.sessionId === event.sessionId),
      duplicate = events.find((e) => e.id === event.id);
    if (duplicate) {
      if (JSON.stringify(duplicate) !== JSON.stringify(event))
        throw new Error("event-identity-collision");
      return;
    }
    if ((events.at(-1)?.sequence ?? 0) !== expected)
      throw new Error("competing-writer");
    this.log.push(structuredClone(event));
  }
}

it("600 seconds at 40 source characters/s retains every expected result within fixed per-item deadlines", async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
  });
  const wallStart = process.hrtime.bigint(),
    epoch = Date.now();
  let liveCalls = 0,
    stageCalls = 0;
  const stageRequests: unknown[] = [];
  const s = await Session.open(
    crypto.randomUUID(),
    async (t, signal) => {
      if (t.review)
        stageRequests.push({
          at: performance.now(),
          request: t.review.request,
        });
      const ms =
        t.lane === "Live"
          ? profile.liveDelays[liveCalls++ % 3]
          : (stageCalls++, profile.stageDelay);
      const answer = interpretWorkload(t.review?.request ?? t.capture!.request);
      await delay(ms, signal);
      return t.review
        ? compileStageDeclarations(t.review.request, answer)
        : answer;
    },
    new ClockStore(`sustained-${crypto.randomUUID()}`),
  );
  const semantic = new Map<
      string,
      { at: number; id: string; version: number }
    >(),
    cues = new Map<string, number>();
  const samples: {
    at: number;
    R: number;
    A: number;
    age: number;
    carry: number;
  }[] = [];
  const observe = () => {
    const state = s.state;
    for (const u of Object.values(state.units)) {
      if (u.meaning.kind === "quantity") {
        const symbol = Object.keys(u.meaning.symbols)[0];
        const value = Array.isArray(u.meaning.expression)
          ? u.meaning.expression[2]
          : undefined;
        expect(u.meaning.symbols[symbol].unit).toBe("kPa");
        expect(u.meaning.conditions).toEqual(["at fixed temperature"]);
        const key = `${symbol}:${value}`;
        if (!semantic.has(key))
          semantic.set(key, {
            at: performance.now(),
            id: u.id,
            version: u.version,
          });
      } else if (u.meaning.kind === "relation") {
        const key = u.meaning.text;
        if (!semantic.has(key))
          semantic.set(key, {
            at: performance.now(),
            id: u.id,
            version: u.version,
          });
      }
    }
    if (state.cue && !cues.has(state.cue.text))
      cues.set(state.cue.text, performance.now());
  };
  const unsubscribe = s.subscribe(observe);
  try {
    for (let time = 0; time < profile.duration; time += 100) {
      if (time % profile.fragmentInterval === 0) {
        const record = workload[time / profile.fragmentInterval];
        await s.commitEvidence({
          id: `e${record.index}`,
          run: "fixed",
          source: String(record.index),
          text: record.text,
          start: time / 1000,
          end: (time + 2000) / 1000,
          receivedAt: performance.now(),
          audioObservedAt: null,
          stability: "COMMITTED",
        });
      }
      await vi.advanceTimersByTimeAsync(100);
      const w = s.window,
        offset = (c: typeof w.recordedFrontier) =>
          c.sequence ? (c.sequence - 1) * 80 + c.offset : 0;
      samples.push({
        at: time + 100,
        R: offset(w.recordedFrontier),
        A: offset(w.accountedFrontier),
        age: w.oldestPendingAge,
        carry: w.carryChars,
      });
    }
    const inputEnd = samples.at(-1)!;
    for (
      let time = 0;
      time < 30000 &&
      (s.window.unaccountedChars ||
        s.window.activeStage ||
        Object.keys(s.replay.unresolved).length);
      time += 100
    )
      await vi.advanceTimersByTimeAsync(100);
    const finalAt = performance.now(),
      events = await s.store.read(s.id),
      tag = (n: number) => String(n).padStart(3, "0");
    const timeline = workload.flatMap((record) => {
      let result: { at: number; id?: string; version?: number } | undefined,
        key = "";
      if (record.kind === "FACT" || record.kind === "CORRECT") {
        key = `p${tag(record.subject)}:${record.value}`;
        result = semantic.get(key);
      } else if (record.kind === "RELATE") {
        key = `Compare samples ${tag(record.subject)} and ${tag(record.other!)}.`;
        result = semantic.get(key);
      } else if (record.kind === "CUE") {
        key = `Compare samples ${tag(record.subject)} and ${tag(record.other!)} at fixed temperature.`;
        const at = cues.get(key);
        if (at !== undefined) result = { at };
      } else if (record.kind === "IDENTIFY") {
        key = `Sample ${tag(record.other!)} follows sample ${tag(record.subject - 1)}.`;
        result = semantic.get(key);
      } else return [];
      let supersededBy: number | undefined;
      if (!result && record.kind === "FACT") {
        const correction = workload.find(
          (other) =>
            other.kind === "CORRECT" &&
            other.subject === record.subject &&
            other.evidenceReadyAt <= record.acceptBy,
        );
        const replacement = correction
          ? semantic.get(`p${tag(record.subject)}:${correction.value}`)
          : undefined;
        // A later explicit correction already in the accepted batch supersedes the earlier value;
        // require its identity and retained original source, never demand publishing a known obsolete value.
        if (
          replacement &&
          s.state.units[replacement.id].basis.some(
            (b) => b.evidenceId === `e${record.index}`,
          )
        ) {
          result = replacement;
          supersededBy = correction!.index;
        }
      }
      return [
        {
          index: record.index,
          supersededBy,
          kind: record.kind,
          key,
          evidenceReadyAt: record.evidenceReadyAt,
          deadline: record.acceptBy,
          ...result,
        },
      ];
    });
    const windows = samples
      .filter((x) => x.at >= 90000 && x.at % 1000 === 0)
      .map((end) => {
        const start = samples.find((x) => x.at === end.at - 60000)!;
        return { end: end.at, ratio: (end.A - start.A) / (end.R - start.R) };
      });
    const reviews = events.flatMap((e) =>
      e.type === "accepted" ? (e.accepted.reviews ?? []) : [],
    );
    const accepted = events.filter(
      (e): e is Extract<Event, { type: "accepted" }> => e.type === "accepted",
    );
    const carryTimeline = workload
      .filter((r) => r.kind === "BIND")
      .map((r) => {
        const prior = accepted.find((e) =>
          e.accepted.unresolved.some(
            (o) => o.evidenceIds.includes(`e${r.subject}`) && o.coreId === null,
          ),
        );
        const obligation = prior?.accepted.unresolved.find((o) =>
          o.evidenceIds.includes(`e${r.subject}`),
        );
        const closed = obligation
          ? accepted.find((e) => e.accepted.resolved.includes(obligation.id))
          : accepted.find((e) =>
              e.accepted.processing?.groups.some(
                (g) =>
                  position(s.replay.evidence, g.range.end) >=
                  r.index * 80 + r.text.trimEnd().length,
              ),
            );
        const target = Object.values(s.state.units).find(
          (u) =>
            u.meaning.kind === "quantity" &&
            u.meaning.symbols[`p${tag(r.other!)}`],
        );
        expect(target?.version).toBe(1);
        if (obligation)
          expect(
            closed?.accepted.resolutions?.some(
              (x) =>
                x.obligation === obligation.id &&
                x.targets.includes(target!.id),
            ),
          ).toBe(true);
        const closedAt = closed ? closed.at - epoch : undefined;
        expect(closedAt).toBeGreaterThanOrEqual(r.evidenceReadyAt);
        expect(closedAt).toBeLessThanOrEqual(r.acceptBy);
        return {
          index: r.index,
          obligation: obligation?.id ?? null,
          target: target!.id,
          createdAt: prior ? prior.at - epoch : null,
          closedAt,
          deadline: r.acceptBy,
          lifetime: prior && closed ? closed.at - prior.at : 0,
          mode: obligation ? "resolution-only" : "clarified-in-capture",
        };
      });
    expect(reviews.filter((r) => r.outcome === "RESOLVED")).toHaveLength(
      workload.filter((r) => r.kind === "IDENTIFY").length,
    );
    expect(
      s.trace.spans.some(
        (x) =>
          x.name === "proposal-rejected" &&
          x.attributes.lane === "Stage" &&
          String(x.attributes.reason).startsWith("stale-dependency"),
      ),
    ).toBe(true);
    const report = {
      profile,
      carryTimeline,
      persistence:
        "zero-time transactional append; real IndexedDB in browser integration",
      stageRequests,
      wallMs: Number(process.hrtime.bigint() - wallStart) / 1e6,
      epoch,
      inputEnd,
      drain: { endedAt: finalAt, sourceChars: s.window.unaccountedChars },
      liveCalls,
      stageCalls,
      maxSourceAge: Math.max(...samples.map((s) => s.age)),
      maxCarryChars: Math.max(...samples.map((s) => s.carry)),
      rejections: s.trace.spans.filter((x) => x.name === "proposal-rejected"),
      unitCount: Object.keys(s.state.units).length,
      unresolved: Object.keys(s.replay.unresolved),
      stage: reviews.map((r) => ({ kind: r.kind, outcome: r.outcome })),
      windows,
      timeline,
    };
    await mkdir("../../.cuelayer/v2/repair", { recursive: true });
    await writeFile(
      "../../.cuelayer/v2/repair/sustained.json",
      JSON.stringify(report, null, 2),
    );
    expect(
      timeline.filter((t) => t.at === undefined),
      JSON.stringify(
        s.trace.spans.filter((x) => x.name === "proposal-rejected").slice(-5),
      ),
    ).toEqual([]);
    for (const result of timeline) {
      expect(result.at!, result.key).toBeGreaterThanOrEqual(
        result.evidenceReadyAt,
      );
      expect(result.at!, result.key).toBeLessThanOrEqual(result.deadline);
    }
    expect(report.unitCount).toBeGreaterThanOrEqual(200);
    expect(report.maxSourceAge).toBeLessThanOrEqual(profile.maxSourceAge);
    expect(Math.min(...windows.map((w) => w.ratio))).toBeGreaterThanOrEqual(
      0.9,
    );
    expect(s.window.unaccountedChars).toBe(0);
    expect(s.replay.unresolved).toEqual({});
    expect(reviews.some((r) => r.outcome === "RESOLVED")).toBe(true);
    expect(stageCalls).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === "evidence")).toHaveLength(300);
    expect(new Set(s.window.consumedEvidenceIds).size).toBe(300);
  } finally {
    unsubscribe();
    s.close();
    vi.useRealTimers();
  }
}, 120000);

it("insufficient request capacity exposes unconsumed evidence and raw backlog age", async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
  });
  let calls = 0;
  const s = await Session.open(
    crypto.randomUUID(),
    async () => {
      calls++;
      throw new Error("must-not-dispatch");
    },
    new ClockStore(`capacity-${crypto.randomUUID()}`),
    {
      coalesceMs: 250,
      maxWaitMs: 750,
      deadlineMs: 8000,
      sourceChars: 2400,
      maxRequestBytes: 200,
    },
  );
  try {
    for (let i = 0; i < 30; i++) {
      const row = workload[i];
      await s.commitEvidence({
        id: `e${i}`,
        run: "capacity",
        source: String(i),
        text: row.text,
        start: i * 2,
        end: i * 2 + 2,
        receivedAt: performance.now(),
        audioObservedAt: null,
        stability: "COMMITTED",
      });
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(calls).toBe(0);
    expect(s.window.status).toBe("INTERPRETATION_PAUSED");
    expect(s.error).toContain("context-blocked");
    expect(s.window.unaccountedChars).toBe(2400);
    expect(s.window.oldestPendingAge).toBe(60000);
    expect(s.replay.unresolved).toEqual({});
    expect(s.state.revision).toBe(0);
    expect(s.replay.evidence).toHaveLength(30);
  } finally {
    s.close();
    vi.useRealTimers();
  }
});

it("a three-page explanation needs four fixed Live rounds, retains original age and consumes only PROCESS", async () => {
  const { fixtureBasis, establish, waitDecision } =
    await import("./frontier-fixtures");
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
  });
  let calls = 0;
  const s = await Session.open(
    crypto.randomUUID(),
    async (t, signal) => {
      calls++;
      const source = t.capture!.request.source,
        context = t.capture!.request.context;
      const page = context.find(
        (c) =>
          c.role === "FOLLOWING_CONTEXT" &&
          c.text.replace(/<b\d+>/g, "").includes("threshold energy"),
      );
      const d = page
        ? establish(t, source.text.replace(/<b\d+>/g, ""), {
            kind: "statement",
            text: "Activation is the threshold energy needed for collisions.",
          })
        : waitDecision(t);
      if (page)
        for (const group of d.groups)
          if (group.outcome === "APPLY")
            for (const op of group.operations)
              op.basis.push(
                ...fixtureBasis(
                  t,
                  "the threshold energy needed for collisions.",
                  page.source,
                ),
              );
      await delay(6000, signal);
      return d;
    },
    new ClockStore(`pages-${crypto.randomUUID()}`),
    {
      coalesceMs: 250,
      maxWaitMs: 750,
      deadlineMs: 8000,
      sourceChars: 14,
      maxRequestBytes: 28000,
    },
  );
  try {
    const text =
      "Activation is " +
      "continued context ".repeat(100) +
      "the threshold energy needed for collisions.";
    await s.commitEvidence({
      id: "e0",
      run: "pages",
      source: "0",
      text,
      start: 0,
      end: 1,
      receivedAt: performance.now(),
      audioObservedAt: null,
      stability: "COMMITTED",
    });
    let acceptedAt: number | undefined;
    const unsubscribe = s.subscribe(() => {
      if (!acceptedAt && Object.keys(s.state.units).length) {
        acceptedAt = performance.now();
        s.pause();
      }
    });
    for (let time = 0; time < 30000 && !acceptedAt; time += 100)
      await vi.advanceTimersByTimeAsync(100);
    unsubscribe();
    expect(Object.keys(s.state.units)).toHaveLength(1);
    expect(calls).toBe(4);
    expect(acceptedAt).toBeLessThanOrEqual(4 * 6000 + 750);
    expect(acceptedAt).toBeGreaterThanOrEqual(24000);
    expect(s.replay.accounted.offset).toBe(14);
    expect(s.window.unaccountedChars).toBe(text.length - 14);
    expect(s.window.oldestPendingAge).toBeGreaterThanOrEqual(24000);
    expect(s.replay.unresolved).toEqual({});
  } finally {
    s.close();
    vi.useRealTimers();
  }
});

it.each(["transport", "semantic"] as const)(
  "sustained %s failure preserves evidence and resumes on the materially newer capture",
  async (category) => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
    });
    let calls = 0;
    const s = await Session.open(
      crypto.randomUUID(),
      async (t, signal) => {
        const answer = interpretWorkload(
          t.review?.request ?? t.capture!.request,
        );
        if (t.lane === "Stage") {
          await delay(6000, signal);
          return compileStageDeclarations(t.review!.request, answer);
        }
        const n = calls++;
        await delay(profile.liveDelays[n % 3], signal);
        if (n === 2) {
          if (category === "transport")
            throw new Error("injected-offline-failure");
          return {};
        }
        return answer;
      },
      new ClockStore(`failure-${crypto.randomUUID()}`),
    );
    let maxAge = 0;
    try {
      for (let at = 0; at < 60000; at += 100) {
        if (at % 2000 === 0) {
          const r = workload[at / 2000];
          await s.commitEvidence({
            id: `e${r.index}`,
            run: "failure",
            source: String(r.index),
            text: r.text,
            start: at / 1000,
            end: at / 1000 + 2,
            receivedAt: performance.now(),
            audioObservedAt: null,
            stability: "COMMITTED",
          });
        }
        await vi.advanceTimersByTimeAsync(100);
        maxAge = Math.max(maxAge, s.window.oldestPendingAge);
      }
      const inputEnd = {
        pending: s.window.unaccountedChars,
        age: s.window.oldestPendingAge,
      };
      for (let i = 0; i < 300 && s.window.unaccountedChars; i++)
        await vi.advanceTimersByTimeAsync(100);
      const events = await s.store.read(s.id),
        failures = events.filter(
          (e) => e.type === "live-attempt" && e.attempt.outcome === "FAILED",
        );
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ attempt: { category } });
      expect(events.filter((e) => e.type === "evidence")).toHaveLength(30);
      expect(s.window.consumedEvidenceIds).toHaveLength(30);
      expect(s.window.unaccountedChars).toBe(0);
      expect(s.replay.unresolved).toEqual({});
      expect(Object.keys(s.state.units).length).toBeGreaterThan(20);
      await mkdir("../../.cuelayer/v2/repair", { recursive: true });
      await writeFile(
        `../../.cuelayer/v2/repair/sustained-${category}.json`,
        JSON.stringify(
          {
            category,
            calls,
            inputEnd,
            maxRawSourceAge: maxAge,
            finalAt: performance.now(),
            failures,
            providerInvocations: 0,
          },
          null,
          2,
        ),
      );
    } finally {
      s.close();
      vi.useRealTimers();
    }
  },
);
