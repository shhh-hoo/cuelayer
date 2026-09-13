import { Stream } from "openai/core/streaming";
import {
  executionObserver,
  type ObservationOptions,
  type ExecutionObservation,
} from "../src/execution-contract";
import { modelProfile, openLiveResponse, type ProviderRequest } from "./live";

export type ProviderDeadline = {
  controller: AbortController;
  close: () => void;
};

/** The HTTP host creates this before reading the body, preserving its deadline.
 * A direct captured-request caller uses the same lifecycle at invocation.
 */
export function createProviderDeadline(
  signal: AbortSignal,
  timeoutMs = modelProfile.providerTimeoutMs,
): ProviderDeadline {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(() => controller.abort("model-timeout"), timeoutMs);
  return {
    controller,
    close() {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    },
  };
}

/** SDK request, deadline, failure classification and forwarding are shared by
 * the HTTP host and direct evaluators; credentials stay on the server side.
 */
export async function providerResponse(
  request: ProviderRequest,
  options: ObservationOptions & {
    apiKey: string;
    model: string;
    signal: AbortSignal;
    fetch?: typeof fetch;
    timeoutMs?: number;
    deadline?: ProviderDeadline;
    forwardObservations?: boolean;
  },
): Promise<Response> {
  const deadline =
    options.deadline ??
    createProviderDeadline(options.signal, options.timeoutMs);
  const { controller } = deadline;
  const pending: ExecutionObservation[] = [];
  const record = (event: ExecutionObservation) => {
    if (options.forwardObservations !== false && pending.length < 16)
      pending.push(event);
    // The observer and forwarded copy share the original monotonic clock stamp.
    return options.observe?.(event);
  };
  const observedOptions = { ...options, observe: record };
  const observe = executionObserver(observedOptions);
  let providerBytes = 0;
  try {
    const upstream = await openLiveResponse(
      request,
      options.apiKey,
      options.model,
      controller.signal,
      (size) => {
        providerBytes = size;
      },
      observedOptions,
    );
    const forwarded = new Stream<unknown>(async function* () {
      let firstAnswer = false;
      try {
        for await (const event of upstream) {
          if (
            event.type === "response.output_text.delta" &&
            event.delta &&
            !firstAnswer
          ) {
            firstAnswer = true;
            observe("first-upstream-answer-text", {
              boundary: "upstream-provider-event",
            });
          }
          if (
            [
              "response.completed",
              "response.incomplete",
              "response.failed",
            ].includes(event.type) &&
            "response" in event
          )
            observe("upstream-terminal", {
              boundary: "upstream-provider-event",
              terminalType: event.type,
              completed:
                event.type === "response.completed" &&
                event.response.status === "completed",
              actualModel: event.response.model,
              responseId: event.response.id,
              usage: event.response.usage,
            });
          // Rejection stops the parser immediately; send its provider facts first.
          if (
            event.type === "response.failed" ||
            event.type === "response.incomplete"
          )
            for (const observation of pending.splice(0))
              yield { type: "v2.observation", observation };
          yield event;
          for (const observation of pending.splice(0))
            yield { type: "v2.observation", observation };
        }
        for (const observation of pending.splice(0))
          yield { type: "v2.observation", observation };
        if (controller.signal.aborted)
          yield { type: "v2.failure", reason: "model-timeout" };
      } catch {
        for (const observation of pending.splice(0))
          yield { type: "v2.observation", observation };
        yield {
          type: "v2.failure",
          reason: controller.signal.aborted
            ? "model-timeout"
            : "model-stream-failed",
        };
      } finally {
        deadline.close();
      }
    }, controller);
    return new Response(forwarded.toReadableStream(), {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson",
        "X-Accel-Buffering": "no",
        "X-V2-Provider-Request-Bytes": String(providerBytes),
      },
    });
  } catch (error) {
    deadline.close();
    // Upstream messages may contain private headers/URLs. Only categories leave.
    const status =
      typeof error === "object" && error && "status" in error
        ? Number(error.status)
        : 0;
    const reason = controller.signal.aborted
      ? "model-timeout"
      : status === 429 || status >= 500
        ? "model-transient"
        : status === 401
          ? "model-auth"
          : "model-request-failed";
    return new Response(
      JSON.stringify({
        error: reason,
        errorType: error instanceof Error ? error.name : "unknown",
        providerStatus: status,
        observations: pending,
      }),
      {
        status: reason === "model-transient" ? 503 : 502,
        headers: {
          "Content-Type": "application/json",
          ...(providerBytes > 0
            ? { "X-V2-Provider-Request-Bytes": String(providerBytes) }
            : {}),
        },
      },
    );
  }
}
