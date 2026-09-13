import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { emptyReplay, fold, type Replay, type Event } from "../src/contract";
import { captureLive } from "../src/projection";
import { captureStage, validateStage } from "../src/stage";
import { validate } from "../src/acceptance";
import {
  decisionEventPayload,
  type DecisionEventPayload,
} from "../src/acceptance-event";
import {
  capturedRequest,
  executeCapturedRequest,
  ExecutionFailure,
  TransientFailure,
  type CapturedRequest,
  type ExecutionObservation,
} from "../src/execution";
import {
  liveRequest,
  livePolicy,
  stagePolicy,
  modelProfile,
  type ProviderRequest,
} from "../server/live";
import {
  createProviderDeadline,
  providerResponse,
} from "../server/provider-execution";
import { establish, waitDecision } from "./frontier-fixtures";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function input() {
  return fold(emptyReplay(), {
    schema: "cuelayer-v2-event-3",
    sessionId: "execution",
    id: "input",
    sequence: 1,
    at: 0,
    type: "evidence",
    evidence: {
      id: "e0",
      sequence: 1,
      run: "r",
      source: "s",
      text: "A mole fraction is a ratio.",
      start: 0,
      end: 1,
      receivedAt: 0,
      audioObservedAt: null,
      stability: "COMMITTED",
    },
  });
}
function publish(replay: Replay, payload: DecisionEventPayload) {
  return fold(replay, {
    schema: "cuelayer-v2-event-3",
    sessionId: "execution",
    id: "event-" + (replay.sequence + 1),
    sequence: replay.sequence + 1,
    at: Date.now(),
    ...payload,
  } as Event);
}
function providerEvents(text: string, terminal = "response.completed") {
  return [
    { type: "response.output_text.delta", delta: text },
    ...(terminal
      ? [
          {
            type: terminal,
            response: {
              status:
                terminal === "response.completed" ? "completed" : "incomplete",
              model: modelProfile.model,
              id: "saved-response",
              usage: { input_tokens: 20, output_tokens: 30 },
            },
          },
        ]
      : []),
  ];
}
function sse(events: unknown[]) {
  return new Response(
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
    {
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}
function execute(
  captured: CapturedRequest,
  transport: typeof fetch,
  observe?: (event: ExecutionObservation) => void | Promise<void>,
) {
  return executeCapturedRequest(captured, {
    signal: new AbortController().signal,
    observe,
    clockId: "host-clock",
    transport: (c, signal) =>
      providerResponse(c.request, {
        apiKey: "offline-test",
        model: modelProfile.model,
        signal,
        fetch: transport,
        clockId: "provider-clock",
        now: () => 42,
      }),
  });
}

it("pins the reviewed declarative Stage and field-grounded Live profile", async () => {
  const formats = [];
  for (const version of ["v2-live-request-4", "v2-stage-request-5"])
    formats.push(
      (await liveRequest({ version } as ProviderRequest)).text.format,
    );
  // #56 intentionally changes provider grammar and per-field grounding;
  // transport/model/deadline equivalence remains separately checked below.
  const digest = createHash("sha256")
    .update(JSON.stringify({ modelProfile, livePolicy, stagePolicy, formats }))
    .digest("hex");
  expect(digest).toBe(
    "0ef3274262aadceb531a0072a060070a1def8f33a9c634021ec976e3b1fac332",
  );
});

it("replays a saved Live response through SDK, parser and acceptance with no Session or global fetch", async () => {
  const replay = input(),
    task = captureLive(replay, "execution", "live", 0);
  const authored = establish(task, replay.evidence[0].text);
  const {
    suffixStatus,
    contextRequest: _contextRequest,
    ...decision
  } = authored;
  const raw = { ...decision, continuation: suffixStatus };
  const observations: ExecutionObservation[] = [];
  const transport = vi.fn(async (_url, init) => {
    expect(JSON.parse(String(init?.body))).toEqual(
      await liveRequest(task.capture!.request),
    );
    return sse(providerEvents(JSON.stringify(raw)));
  }) as typeof fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("global-fetch-forbidden");
    }),
  );
  const result = await execute(capturedRequest(task), transport, (event) => {
    observations.push(event);
  });
  expect(result.proposal).toEqual(authored);
  expect(result.provider).toMatchObject({
    completed: true,
    terminalType: "response.completed",
    responseId: "saved-response",
  });
  const validation = validate(replay, task, result.proposal);
  const after = publish(replay, decisionEventPayload(task, validation));
  expect(Object.values(after.state.units).map((u) => u.meaning)).toEqual([
    { kind: "statement", text: replay.evidence[0].text },
  ]);
  expect(after.accounted).toEqual(after.recorded);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  const phases = observations.map((e) => e.phase);
  expect(phases).toEqual(
    expect.arrayContaining([
      "request-dispatch",
      "response-headers",
      "first-response-byte",
      "provider-dispatch",
      "provider-headers",
      "first-upstream-byte",
      "first-upstream-answer-text",
      "first-answer-text",
      "upstream-terminal",
      "provider-terminal",
      "parser-complete",
      "attempt-finished",
    ]),
  );
  expect(observations.filter((e) => e.phase === "provider-dispatch")).toEqual([
    expect.objectContaining({
      at: 42,
      clockId: "provider-clock",
      details: expect.objectContaining({
        attemptId: result.attemptId,
        taskId: task.id,
      }),
    }),
  ]);
  expect(
    observations
      .filter((e) => e.clockId === "host-clock")
      .every((e, i, rows) => !i || e.at >= rows[i - 1].at),
  ).toBe(true);
  expect(observations.at(-1)?.details).toMatchObject({
    providerCompleted: true,
    parserSucceeded: true,
    attemptId: result.attemptId,
  });
});

it("replays Stage through the same executor and acceptance while preserving source accounting", async () => {
  const replay = input(),
    task = captureLive(replay, "execution", "live", 0);
  const decision = establish(task, replay.evidence[0].text);
  decision.reviewRequests = [
    {
      core: task.capture!.request.newCores[0],
      targets: [task.capture!.request.newUnits[0]],
      purpose: "Review terminology",
    },
  ];
  const before = publish(
    replay,
    decisionEventPayload(task, validate(replay, task, decision)),
  );
  const stage = captureStage(before, "execution", "stage", 0)!;
  const raw = {
    scope: stage.review!.namespace,
    results: stage.review!.items.map((i) => ({
      item: i.id,
      outcome: "STILL_OPEN",
    })),
  };
  const result = await execute(
    capturedRequest(stage),
    vi.fn(async () => sse(providerEvents(JSON.stringify(raw)))) as typeof fetch,
  );
  const accepted = decisionEventPayload(
    stage,
    validateStage(before, stage, result.proposal),
  );
  expect(accepted.type).toBe("accepted");
  const after = publish(before, accepted);
  expect(after.accounted).toEqual(before.accounted);
  expect(after.state).toEqual(before.state);
  expect(Object.keys(after.reviewInspections)).toHaveLength(1);
});

it.each([
  ["{", "response.completed", "model-malformed-json", true, true],
  [
    '{"complete":true}',
    "response.completed",
    "model-schema-invalid",
    true,
    true,
  ],
  ["{}", "response.incomplete", "model-incomplete", false, false],
  ["{}", "", "model-disconnected-before-complete", false, false],
])(
  "keeps provider completion distinct from parsing failure (%s)",
  async (text, terminal, reason, completed, parserAttempted) => {
    const task = captureLive(input(), "execution", "failure", 0),
      observations: ExecutionObservation[] = [];
    const error = await execute(
      capturedRequest(task),
      vi.fn(async () =>
        sse(providerEvents(text as string, terminal as string)),
      ) as typeof fetch,
      (event) => {
        observations.push(event);
      },
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ExecutionFailure);
    expect(error.message).toBe(reason);
    expect(error.provider.completed).toBe(completed);
    expect(error.outputText).toBe(text);
    if (terminal)
      expect(
        observations.some(
          (e) =>
            e.phase === "upstream-terminal" && e.clockId === "provider-clock",
        ),
      ).toBe(true);
    expect(observations.at(-1)?.details).toMatchObject({
      providerCompleted: completed,
      parserAttempted,
      parserSucceeded: false,
    });
  },
);

it("preserves 429/5xx retry classification without adding SDK retries", async () => {
  const observations: ExecutionObservation[] = [];
  const transport = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          error: { message: "rate limited", type: "rate_limit_error" },
        }),
        { status: 429 },
      ),
  );
  const task = captureLive(input(), "execution", "transient", 0);
  await expect(
    execute(capturedRequest(task), transport as typeof fetch, (event) => {
      observations.push(event);
    }),
  ).rejects.toBeInstanceOf(TransientFailure);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(
    observations.find((e) => e.phase === "provider-payload")?.details
      .serializedProviderRequestBytes,
  ).toBeGreaterThan(0);
});

const pendingFetch: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    const abort = () =>
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    init?.signal?.addEventListener("abort", abort, { once: true });
    if (init?.signal?.aborted) abort();
  });

it("uses the original pre-body provider deadline and reports timeout without provider/parser completion", async () => {
  vi.useFakeTimers();
  const parent = new AbortController(),
    deadline = createProviderDeadline(parent.signal);
  await vi.advanceTimersByTimeAsync(5000);
  const observations: ExecutionObservation[] = [],
    task = captureLive(input(), "execution", "timeout", 0);
  const pending = executeCapturedRequest(capturedRequest(task), {
    signal: parent.signal,
    observe: (event) => {
      observations.push(event);
    },
    transport: (c, signal) =>
      providerResponse(c.request, {
        apiKey: "offline",
        model: modelProfile.model,
        signal,
        deadline,
        fetch: pendingFetch,
      }),
  }).catch((e) => e);
  await vi.advanceTimersByTimeAsync(999);
  expect(observations.some((e) => e.phase === "attempt-finished")).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  const error = await pending;
  expect(error.message).toBe("model-timeout");
  expect(error.provider.completed).toBe(false);
  expect(
    observations.some(
      (e) => e.phase === "first-answer-text" || e.phase === "parser-complete",
    ),
  ).toBe(false);
  expect(observations.at(-1)?.details).toMatchObject({
    providerCompleted: false,
    parserAttempted: false,
    parserSucceeded: false,
  });
});

it("aborts an active upstream stream and never parses a late incomplete answer", async () => {
  const parent = new AbortController(),
    cancelled = vi.fn();
  const observations: ExecutionObservation[] = [],
    task = captureLive(input(), "execution", "abort", 0);
  const transport = vi.fn(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "{" })}\n\n`,
              ),
            );
          },
          cancel: cancelled,
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
  ) as typeof fetch;
  const pending = executeCapturedRequest(capturedRequest(task), {
    signal: parent.signal,
    observe: (event) => {
      observations.push(event);
    },
    transport: (c, signal) =>
      providerResponse(c.request, {
        apiKey: "offline",
        model: modelProfile.model,
        signal,
        fetch: transport,
      }),
  }).catch((e) => e);
  await vi.waitFor(() =>
    expect(observations.some((e) => e.phase === "first-answer-text")).toBe(
      true,
    ),
  );
  parent.abort(new DOMException("cancelled", "AbortError"));
  expect(await pending).toBeInstanceOf(Error);
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1));
  expect(observations.some((e) => e.phase === "parser-complete")).toBe(false);
  expect(observations.at(-1)?.details).toMatchObject({
    providerCompleted: false,
    parserSucceeded: false,
  });
});

it("isolates throwing, rejected and unfinished observers from the result", async () => {
  const task = captureLive(input(), "execution", "observers", 0),
    raw = waitDecision(task);
  for (const observe of [
    () => {
      throw Error("sink failed");
    },
    () => Promise.reject(Error("sink rejected")),
    () => new Promise<void>(() => {}),
  ]) {
    const result = await execute(
      capturedRequest(task),
      vi.fn(async () =>
        sse(providerEvents(JSON.stringify(raw))),
      ) as typeof fetch,
      observe,
    );
    expect(result.proposal).toEqual(raw);
  }
});

it("shares accepted and zero-group inspection payloads including continuation alias resolution", () => {
  const replay = input(),
    task = captureLive(replay, "execution", "payload", 0);
  const accepted = validate(
    replay,
    task,
    establish(task, replay.evidence[0].text),
  );
  expect(decisionEventPayload(task, accepted)).toEqual({
    type: "accepted",
    accepted: accepted.accepted,
  });
  const waiting = validate(replay, task, waitDecision(task));
  expect(decisionEventPayload(task, waiting)).toEqual({
    type: "inspected",
    taskId: task.id,
    context: task.capture!.inspectionContext,
    inspectionKey: task.inspectionKey,
    outcome: "WAIT_MORE_INPUT",
  });
  // Isolate the event mapping for an already validated pagination invitation.
  task.capture!.units.u0 = "durable-unit";
  waiting.decision.contextRequest = {
    query: "pressure",
    purpose: "READ",
    after: "u0",
  };
  expect(decisionEventPayload(task, waiting)).toMatchObject({
    type: "inspected",
    context: {
      query: { query: "pressure", purpose: "READ", after: "durable-unit" },
    },
  });
  waiting.decision.contextRequest.after = null;
  expect(decisionEventPayload(task, waiting)).toMatchObject({
    context: { query: { after: null } },
  });
});
