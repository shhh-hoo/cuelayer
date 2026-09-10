import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import { Session } from "../src/session";
import { EventStore } from "../src/adapters/storage";
import { realInterpreter } from "../src/adapters/live";
import {
  AudioObservationClock,
  RealtimeIngress,
  speechConfiguration,
} from "../src/adapters/microphone";
import { Trace } from "../src/adapters/trace";
import { liveRequest, modelProfile } from "../server/live";
import { hostSlots } from "../src/model-context";
import type { Task } from "../src/contract";
import { validate } from "../src/acceptance";

const task: Task = {
  id: "host-task-1",
  lane: "Live",
  evidence: [],
  dependencies: { mainline: 0, cue: 0 },
  state: {
    revision: 0,
    cores: {},
    units: {},
    currentCoreId: null,
    mainlineVersion: 0,
    cue: null,
    cueVersion: 0,
  },
  obligations: [],
  allowedCores: [],
  createdAt: 0,
  attentionEpoch: 0,
};
const proposal = {
  version: "v2-proposal-1",
  taskId: task.id,
  complete: true,
  operations: [],
  dispositions: [],
  unresolved: [],
  resolve: [],
  attention: null,
};
function response(
  text: string,
  terminal = "response.completed",
  split = false,
) {
  const events = [
    { type: "response.output_text.delta", delta: text },
    ...(terminal
      ? [
          {
            type: terminal,
            response: {
              status:
                terminal === "response.completed" ? "completed" : "incomplete",
              model: "gpt-5.6-luna",
              id: "provider-response",
              usage: { input_tokens: 10, output_tokens: 20 },
            },
          },
        ]
      : []),
  ];
  const bytes = new TextEncoder().encode(
    events.map((e) => JSON.stringify(e) + "\n").join(""),
  );
  return new Response(
    new ReadableStream({
      start(c) {
        if (split) for (const b of bytes) c.enqueue(new Uint8Array([b]));
        else c.enqueue(bytes);
        c.close();
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" } },
  );
}
describe("official SDK transport → existing proposal port", () => {
  it("fixes Current model profile, includes only bounded host context and issues stable IDs", async () => {
    const request = await liveRequest(task);
    expect(request).toMatchObject({
      model: "gpt-5.6-luna",
      reasoning: { effort: "low" },
      max_output_tokens: 8192,
      store: false,
      text: { format: { type: "json_schema", strict: false } },
    });
    expect(modelProfile.sdkRetries).toBe(0);
    expect(JSON.parse(request.input[1].content).task.dependencies).toEqual(
      task.dependencies,
    );
    expect(await hostSlots(task)).toEqual(
      await hostSlots(structuredClone(task)),
    );
    await expect(
      liveRequest({
        ...task,
        obligations: [
          {
            id: "large",
            phrase: "x".repeat(32000),
            evidenceIds: [],
            coreId: null,
            createdAt: 0,
          },
        ],
      }),
    ).rejects.toThrow("context-budget");
  });
  it("handles byte-split UTF-8/JSON, records first output once, returns only after terminal completion", async () => {
    const trace = new Trace(),
      first = vi.fn();
    const interpret = realInterpreter(
      () => trace,
      vi.fn(async () =>
        response(JSON.stringify(proposal), "response.completed", true),
      ) as typeof fetch,
    );
    expect(await interpret(task, new AbortController().signal, first)).toEqual(
      proposal,
    );
    expect(first).toHaveBeenCalledTimes(1);
    expect(trace.spans.map((s) => s.name)).toContain("model-complete");
  });
  it.each([
    ["{", "response.completed", "model-malformed-json"],
    ['{"complete":true}', "response.completed", "model-schema-invalid"],
    [JSON.stringify(proposal), "", "model-disconnected-before-complete"],
    [JSON.stringify(proposal), "response.incomplete", "model-incomplete"],
    ["x".repeat(131073), "response.completed", "model-output-budget"],
  ])(
    "rejects malformed/incomplete/budget output",
    async (text, terminal, reason) => {
      const interpret = realInterpreter(
        () => undefined,
        vi.fn(async () => response(text, terminal)) as typeof fetch,
      );
      await expect(
        interpret(task, new AbortController().signal, () => {}),
      ).rejects.toThrow(reason);
    },
  );
  it("rejects provider-authored new identity", async () => {
    const raw = {
      ...proposal,
      operations: [
        {
          type: "core",
          id: "made-up",
          title: "Topic",
          basis: [{ evidenceId: "e", quote: "Topic" }],
        },
      ],
    };
    await expect(
      realInterpreter(
        () => undefined,
        vi.fn(async () => response(JSON.stringify(raw))) as typeof fetch,
      )(task, new AbortController().signal, () => {}),
    ).rejects.toThrow("model-unissued-core-id");
  });
  it("streamed output cannot publish before complete response and grounding validation", async () => {
    const store = new EventStore(`v2-provider-${crypto.randomUUID()}`),
      trace = new Trace();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const request = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            async start(c) {
              c.enqueue(
                new TextEncoder().encode(
                  `${JSON.stringify({ type: "response.output_text.delta", delta: JSON.stringify(proposal) })}\n`,
                ),
              );
              await gate;
              c.close();
            },
          }),
        ),
    ) as typeof fetch;
    const session = await Session.open(
      crypto.randomUUID(),
      realInterpreter(() => trace, request),
      store,
    );
    await session.commitEvidence({
      id: "e",
      run: "r",
      source: "s",
      text: "Teaching",
      start: 0,
      end: 1,
      receivedAt: performance.now(),
      audioObservedAt: null,
      stability: "COMMITTED",
    });
    await vi.waitFor(() =>
      expect(trace.spans.some((s) => s.name === "model-first-output")).toBe(
        true,
      ),
    );
    expect(session.state.revision).toBe(0);
    expect(session.window.consumedEvidenceIds).toEqual([]);
    release();
    await vi.waitFor(() =>
      expect(session.error).toBe("model-disconnected-before-complete"),
    );
    expect(session.window.consumedEvidenceIds).toEqual([]);
    session.close();
    await store.delete();
  });
});
it("keeps the supported Speechmatics configuration unchanged", () => {
  expect(speechConfiguration(48000)).toMatchObject({
    transcription_config: {
      language: "cmn_en",
      model: "enhanced",
      max_delay: 1.5,
      max_delay_mode: "flexible",
      enable_partials: true,
    },
    audio_format: { sample_rate: 48000, encoding: "pcm_f32le" },
  });
  expect(speechConfiguration(48000).transcription_config).not.toHaveProperty(
    "conversation_config",
  );
});
it("maps observed audio sample positions and reports gaps instead of startup timestamps", () => {
  const clock = new AudioObservationClock();
  expect(clock.at(1)).toBe(null);
  clock.observe(480, 48000, 1000);
  clock.observe(480, 48000, 1010);
  expect(clock.at(0.01)).toBeCloseTo(1000);
  expect(clock.at(0.02)).toBeCloseTo(1010);
  expect(clock.at(0.03)).toBe(null);
  for (let i = 0; i < 1300; i++) clock.observe(4800, 48000, 1100 + i * 100);
  expect(clock.at(0.01)).toBe(null);
});
it("receives finals during failed storage, retains receipt/identity, retries the contiguous frontier", async () => {
  const store = new EventStore(`v2-speech-${crypto.randomUUID()}`);
  const s = await Session.open(
    crypto.randomUUID(),
    async () => proposal,
    store,
  );
  s.pause();
  const failed = vi.fn(),
    ingress = new RealtimeIngress(s, failed),
    original = store.append.bind(store);
  const append = vi
    .spyOn(store, "append")
    .mockRejectedValueOnce(new Error("disk-unavailable"));
  const msg = (start: number, text = "repeated wording") => ({
    message: "AddTranscript" as const,
    metadata: { transcript: text, start_time: start, end_time: start + 1 },
  });
  ingress.receive(msg(0));
  ingress.receive(msg(1));
  await ingress.settled();
  expect(s.replay.evidence).toHaveLength(0);
  expect(ingress.pending.size).toBe(2);
  const first = [...ingress.pending.values()][0];
  append.mockImplementation(original);
  await ingress.retry();
  expect(s.replay.evidence.map((e) => e.sequence)).toEqual([1, 2]);
  expect(s.replay.evidence[0].receivedAt).toBe(first.receivedAt);
  ingress.receive(msg(0));
  await ingress.settled();
  expect(s.replay.evidence).toHaveLength(2);
  ingress.receive(msg(2, "similar but distinct wording"));
  await ingress.settled();
  expect(s.replay.evidence).toHaveLength(3);
  ingress.receive(msg(0, "conflicting text"));
  await ingress.settled();
  expect(failed).toHaveBeenLastCalledWith("evidence-identity-collision");
  s.close();
  await store.delete();
});
it("ignores empty provider finals without blocking later nonempty evidence", async () => {
  const store = new EventStore(`v2-empty-${crypto.randomUUID()}`);
  const s = await Session.open(
    crypto.randomUUID(),
    async () => proposal,
    store,
  );
  s.pause();
  const failed = vi.fn(),
    ingress = new RealtimeIngress(s, failed);
  for (const text of ["", "   ", "A complete statement."])
    ingress.receive({
      message: "AddTranscript",
      metadata: { transcript: text, start_time: 0, end_time: 1 },
    });
  await ingress.settled();
  expect(failed).not.toHaveBeenCalled();
  expect(s.replay.evidence.map((e) => e.sequence)).toEqual([1]);
  expect(ingress.pending.size).toBe(0);
  s.close();
  await store.delete();
});
it("bounds unresolved context and permits grounded continuation without re-consuming old fragments", async () => {
  const store = new EventStore(`v2-context-${crypto.randomUUID()}`);
  const s = await Session.open(
    crypto.randomUUID(),
    async () => proposal,
    store,
  );
  s.pause();
  for (let i = 0; i < 18; i++) {
    await s.commitEvidence({
      id: `e${i}`,
      run: "r",
      source: String(i),
      text: `fragment ${i}`,
      start: i,
      end: i + 1,
      receivedAt: performance.now(),
      audioObservedAt: null,
      stability: "COMMITTED",
    });
    const t = s.capture("Live", [s.replay.evidence.at(-1)!], []);
    await s.accept(t, {
      ...proposal,
      taskId: t.id,
      dispositions: [{ evidenceId: `e${i}`, status: "unresolved" }],
      unresolved: [
        { evidenceId: `e${i}`, phrase: `fragment ${i}`, coreId: null },
      ],
    });
  }
  await s.commitEvidence({
    id: "tail",
    run: "r",
    source: "tail",
    text: "completes the relationship",
    start: 18,
    end: 19,
    receivedAt: performance.now(),
    audioObservedAt: null,
    stability: "COMMITTED",
  });
  const t = s.capture("Live", [s.replay.evidence.at(-1)!], []);
  expect(t.obligations).toHaveLength(16);
  expect(t.contextEvidence?.map((e) => e.id)).toEqual(
    Array.from({ length: 16 }, (_, i) => `e${i + 2}`),
  );
  expect(t.omittedObligations).toBe(2);
  expect(Object.keys(s.window.unresolved)).toHaveLength(18);
  const raw = {
    ...proposal,
    taskId: t.id,
    operations: [
      {
        type: "core",
        id: "core",
        title: "Relationship",
        basis: [
          { evidenceId: "e17", quote: "fragment 17" },
          { evidenceId: "tail", quote: "completes the relationship" },
        ],
      },
    ],
    dispositions: [{ evidenceId: "tail", status: "established" }],
    resolve: ["obligation:e17"],
  };
  expect(() => validate(s.replay, { ...t, contextEvidence: [] }, raw)).toThrow(
    "ungrounded-quote",
  );
  expect(() =>
    validate(
      s.replay,
      {
        ...t,
        contextEvidence: [{ ...t.contextEvidence![0], text: "fabricated" }],
      },
      raw,
    ),
  ).toThrow("uncommitted-evidence");
  expect(() =>
    validate(s.replay, t, {
      ...raw,
      dispositions: [
        { evidenceId: "e17", status: "no-change" },
        ...raw.dispositions,
      ],
    }),
  ).toThrow("incomplete-consumption");
  await s.accept(t, raw);
  expect(s.window.consumedEvidenceIds).toHaveLength(19);
  expect(Object.keys(s.window.unresolved)).toHaveLength(17);
  expect(s.replay.consumed.e17.status).toBe("unresolved");
  s.close();
  await store.delete();
});
