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
import type { Task } from "../src/contract";
import { validate } from "../src/acceptance";

import { emptyReplay } from "../src/contract";
import { captureLive } from "../src/projection";
import { recorded } from "../src/source";
import { waitDecision } from "./frontier-fixtures";
import { expandProviderDecision } from "../src/live-wire";
const replay = emptyReplay();
replay.evidence = [
  {
    id: "e",
    run: "r",
    source: "s",
    text: "Teaching",
    start: 0,
    end: 1,
    receivedAt: 0,
    audioObservedAt: null,
    sequence: 1,
    stability: "COMMITTED",
  },
];
replay.recorded = recorded(replay.evidence);
const task = captureLive(replay, "test", "test1", 0);
const proposal = waitDecision();
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
  it("expands a completed provider continuation into the existing captured proposal port", async () => {
    const wire = {
      scope: "test1",
      groups: [],
      reviewRequests: [],
      attentionCandidate: null,
      continuation: {
        query: "existing quantity",
        purpose: "READ",
        after: null,
      },
    };
    const interpret = realInterpreter(
      () => undefined,
      vi.fn(async () => response(JSON.stringify(wire))) as typeof fetch,
    );
    expect(
      await interpret(task, new AbortController().signal, () => {}),
    ).toEqual(expandProviderDecision(wire));
  });
  it("fixes Current model profile, includes only bounded host context and issues stable IDs", async () => {
    const request = await liveRequest(task.capture!.request);
    expect(request).toMatchObject({
      model: "gpt-6-astra",
      reasoning: { effort: "medium" },
      service_tier: "default",
      max_output_tokens: 8192,
      store: false,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(modelProfile.sdkRetries).toBe(0);
    expect(JSON.parse(request.input[1].content)).not.toHaveProperty(
      "dependencies",
    );
    expect(JSON.parse(request.input[1].content).source.role).toBe("PROCESS");
    expect(task.capture?.cores).toEqual(structuredClone(task).capture?.cores);
    await expect(
      liveRequest({
        ...task.capture!.request,
        obligations: [
          {
            id: "large",
            phrase: "x".repeat(32000),
            kind: "CONTEXT_REQUIRED",
            source: "s0",
            core: null,
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
    ).rejects.toThrow("model-schema-invalid");
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
