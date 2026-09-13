import { Stream } from "openai/core/streaming";
import type { ResponseStreamEvent } from "openai/resources/responses/responses";
import type { Task } from "./contract";
import { bytes } from "./projection";
import { stageReviewSchema } from "./stage";
import { liveDecisionSchema, expandProviderDecision } from "./live-wire";

export * from "./execution-contract";
import {
  executionObserver,
  deliverObservation,
  ExecutionFailure,
  TransientFailure,
  type CapturedRequest,
  type ExecutionResult,
  type ExecutionObservation,
  type ObservationOptions,
  type ExecutionTransport,
  type ProviderCompletion,
} from "./execution-contract";

export function capturedRequest(task: Task): CapturedRequest {
  const request =
    task.lane === "Stage" ? task.review?.request : task.capture?.request;
  if (!request) throw new ExecutionFailure("missing-task-capture");
  return {
    taskId: task.id,
    lane: task.lane,
    request: structuredClone(request),
  };
}

/** One attempt: immutable captured input, complete provider stream, then wire parsing.
 * Scheduling, retries, acceptance and publication remain the caller's responsibility.
 */
export async function executeCapturedRequest(
  captured: CapturedRequest,
  options: ObservationOptions & {
    signal: AbortSignal;
    transport: ExecutionTransport;
    onFirstByte?: () => void;
  },
): Promise<ExecutionResult> {
  const attemptId = crypto.randomUUID();
  const request = structuredClone(captured);
  const { signal } = options;
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const observe = executionObserver(options);
  let forwardedObservations = 0;
  const upstreamObservation = (event: ExecutionObservation) => {
    if (
      event &&
      [
        "provider-dispatch",
        "provider-headers",
        "first-upstream-byte",
        "first-upstream-answer-text",
        "upstream-terminal",
      ].includes(event.phase) &&
      Number.isFinite(event.at) &&
      typeof event.clockId === "string" &&
      event.clockId.length <= 160 &&
      event.details &&
      typeof event.details === "object" &&
      !Array.isArray(event.details) &&
      forwardedObservations < 16 &&
      bytes(event) <= 8192
    ) {
      forwardedObservations++;
      deliverObservation(options, {
        ...event,
        details: {
          ...event.details,
          taskId: request.taskId,
          lane: request.lane,
          attemptId,
        },
      });
    }
  };
  const mark = (phase: string, details: Record<string, unknown> = {}) =>
    observe(phase, {
      ...details,
      taskId: request.taskId,
      lane: request.lane,
      attemptId,
    });
  let text = "",
    firstAnswer = false,
    firstByte = false,
    parserAttempted = false,
    parserSucceeded = false;
  const provider: ProviderCompletion = {
    completed: false,
    terminalType: null,
    actualModel: null,
    responseId: null,
    usage: null,
  };
  try {
    signal.throwIfAborted();
    mark("request-dispatch", {
      contextCharacters: JSON.stringify(request.request).length,
      serializedRequestBytes: bytes(request.request),
    });
    const response = await options.transport(request, controller.signal);
    mark("response-headers", {
      status: response.status,
      boundary: "forwarded-http",
    });
    const providerBytes = Number(
      response.headers.get("X-V2-Provider-Request-Bytes"),
    );
    if (providerBytes > 0)
      mark("provider-payload", {
        serializedProviderRequestBytes: providerBytes,
      });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (Array.isArray(body.observations))
        body.observations.slice(0, 16).forEach(upstreamObservation);
      mark("http-failure", {
        status: response.status,
        errorType: body.errorType,
        providerStatus: body.providerStatus,
      });
      const reason =
        typeof body.error === "string"
          ? body.error
          : `model-http-${response.status}`;
      if (reason === "model-transient") throw new TransientFailure(reason);
      throw new ExecutionFailure(reason);
    }
    if (!response.body) throw new ExecutionFailure("model-missing-stream");
    const observedBody = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, downstream) {
          if (!firstByte && chunk.byteLength) {
            firstByte = true;
            try {
              options.onFirstByte?.();
            } catch {
              /* Diagnostic callback only. */
            }
            mark("first-response-byte", {
              boundary: "first-forwarded-provider-stream-byte",
            });
          }
          downstream.enqueue(chunk);
        },
      }),
    );
    for await (const event of Stream.fromReadableStream<
      | ResponseStreamEvent
      | { type: "v2.failure"; reason: string }
      | { type: "v2.observation"; observation: ExecutionObservation }
    >(observedBody, controller)) {
      if (event.type === "v2.observation") {
        upstreamObservation(event.observation);
        continue;
      }
      if (event.type === "v2.failure") throw new ExecutionFailure(event.reason);
      if (event.type === "response.output_text.delta") {
        if (!firstAnswer && event.delta) {
          firstAnswer = true;
          mark("first-answer-text");
        }
        text += event.delta;
        if (text.length > 131072)
          throw new ExecutionFailure("model-output-budget");
      }
      if (event.type === "response.refusal.delta")
        throw new ExecutionFailure("model-refusal");
      if (
        [
          "response.completed",
          "response.failed",
          "response.incomplete",
        ].includes(event.type)
      ) {
        const terminal = event as Extract<
          ResponseStreamEvent,
          {
            type:
              "response.completed" | "response.failed" | "response.incomplete";
          }
        >;
        Object.assign(provider, {
          terminalType: terminal.type,
          completed:
            terminal.type === "response.completed" &&
            terminal.response.status === "completed",
          actualModel: terminal.response.model ?? null,
          responseId: terminal.response.id ?? null,
          usage: terminal.response.usage ?? null,
        });
        mark("provider-terminal", {
          ...provider,
          boundary: "forwarded-provider-event",
          outputCharacters: text.length,
          output: text,
        });
      }
      if (
        event.type === "response.failed" ||
        event.type === "response.incomplete" ||
        event.type === "error"
      )
        throw new ExecutionFailure("model-incomplete");
    }
    signal.throwIfAborted();
    if (!provider.completed)
      throw new ExecutionFailure("model-disconnected-before-complete");
    mark("parser-start");
    parserAttempted = true;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ExecutionFailure("model-malformed-json");
    }
    // Expand transport syntax only; no semantic values or grounding are added.
    if (
      request.lane === "Live" &&
      raw &&
      typeof raw === "object" &&
      "continuation" in raw
    ) {
      try {
        raw = expandProviderDecision(raw);
      } catch {
        throw new ExecutionFailure("model-schema-invalid");
      }
    }
    const parsed = (
      request.lane === "Live" ? liveDecisionSchema : stageReviewSchema
    ).safeParse(raw);
    if (!parsed.success) throw new ExecutionFailure("model-schema-invalid");
    parserSucceeded = true;
    mark("parser-complete", { succeeded: true });
    return {
      attemptId,
      proposal: raw,
      outputText: text,
      provider: { ...provider },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (parserAttempted && !parserSucceeded)
      mark("parser-complete", { succeeded: false, reason });
    const failure =
      error instanceof ExecutionFailure
        ? error
        : new ExecutionFailure(reason, { cause: error });
    if (error instanceof Error) failure.name = error.name;
    failure.attemptId = attemptId;
    failure.outputText = text;
    failure.provider = { ...provider };
    mark("execution-failure", {
      reason: signal.aborted
        ? "model-timeout-or-cancelled"
        : reason.slice(0, 160),
      output: text,
    });
    throw failure;
  } finally {
    controller.abort();
    signal.removeEventListener("abort", abort);
    mark("attempt-finished", {
      providerCompleted: provider.completed,
      parserAttempted,
      parserSucceeded,
    });
  }
}
