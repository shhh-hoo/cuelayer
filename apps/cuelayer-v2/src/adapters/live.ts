import {
  capturedRequest,
  executeCapturedRequest,
  type Interpreter,
} from "../execution";
import type { Trace } from "./trace";

export function realInterpreter(
  trace: () => Trace | undefined,
  request = fetch,
): Interpreter {
  return async (task, signal, firstOutput) => {
    const result = await executeCapturedRequest(capturedRequest(task), {
      signal,
      onFirstByte: firstOutput,
      transport: (captured, signal) =>
        request("/api/v2/live", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(captured.request),
          signal,
        }),
      observe: ({ phase, at, clockId, details }) => {
        const names: Record<string, string> = {
          "request-dispatch": "model-request",
          "provider-payload": "model-provider-payload",
          "http-failure": "model-http-failure",
          "first-response-byte": "model-first-byte",
          "first-answer-text": "model-first-output",
          "execution-failure": "model-failure",
          "parser-complete":
            task.lane === "Live"
              ? "schema-valid-live-decision"
              : "schema-valid-stage-review",
        };
        const name =
          phase === "parser-complete" && !details.succeeded
            ? "model-parser-failed"
            : phase === "provider-terminal" &&
                details.terminalType === "response.completed"
              ? "model-complete"
              : (names[phase] ?? `model-${phase}`);
        trace()?.mark(
          name,
          { taskId: task.id, lane: task.lane, ...details, clockId },
          at,
          undefined,
          at,
        );
      },
    });
    return result.proposal;
  };
}
