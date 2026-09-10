import { hostSlots } from "../model-context";
import { Stream } from "openai/core/streaming";
import type { ResponseStreamEvent } from "openai/resources/responses/responses";
import { proposalSchema } from "../contract";
import { TransientFailure, type Interpreter } from "../session";
import type { Trace } from "./trace";

export function realInterpreter(
  trace: () => Trace | undefined,
  request = fetch,
): Interpreter {
  return async (task, signal, firstOutput) => {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const observe = (name: string, data: Record<string, unknown> = {}) => {
      try {
        trace()?.mark(name, { taskId: task.id, lane: task.lane, ...data });
      } catch {
        /* diagnostic only */
      }
    };
    let text = "",
      first = false,
      completed = false;
    try {
      observe("model-request", {
        contextCharacters: JSON.stringify(task).length,
      });
      const response = await request("/api/v2/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(task),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        observe("model-http-failure", {
          status: response.status,
          errorType: body.errorType,
          providerStatus: body.providerStatus,
        });
        const reason =
          typeof body.error === "string"
            ? body.error
            : `model-http-${response.status}`;
        if (reason === "model-transient") throw new TransientFailure(reason);
        throw new Error(reason);
      }
      if (!response.body) throw new Error("model-missing-stream");
      for await (const event of Stream.fromReadableStream<
        ResponseStreamEvent | { type: "v2.failure"; reason: string }
      >(response.body, controller)) {
        if (event.type === "v2.failure") throw new Error(event.reason);
        if (event.type === "response.output_text.delta") {
          if (!first && event.delta) {
            first = true;
            firstOutput();
            observe("model-first-output");
          }
          text += event.delta;
          if (text.length > 131072) throw new Error("model-output-budget");
        }
        if (event.type === "response.refusal.delta")
          throw new Error("model-refusal");
        if (
          event.type === "response.failed" ||
          event.type === "response.incomplete" ||
          event.type === "error"
        )
          throw new Error("model-incomplete");
        if (event.type === "response.completed") {
          completed = event.response.status === "completed";
          observe("model-complete", {
            actualModel: event.response.model,
            responseId: event.response.id,
            usage: event.response.usage,
            outputCharacters: text.length,
            output: text,
          });
        }
      }
      signal.throwIfAborted();
      if (!completed) throw new Error("model-disconnected-before-complete");
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new Error("model-malformed-json");
      }
      // Complete JSON is still only a proposal. Session.accept is the truth boundary.
      const parsed = proposalSchema.safeParse(raw);
      if (!parsed.success) throw new Error("model-schema-invalid");
      const slots = await hostSlots(task);
      for (const op of parsed.data.operations) {
        if (op.type === "core" && !slots.newCoreIds.includes(op.id))
          throw new Error("model-unissued-core-id");
        if (
          op.type === "put" &&
          !task.state.units[op.id] &&
          !slots.newUnitIds.includes(op.id)
        )
          throw new Error("model-unissued-unit-id");
      }
      return raw;
    } catch (error) {
      observe("model-failure", {
        reason: signal.aborted
          ? "model-timeout-or-cancelled"
          : error instanceof Error
            ? error.message.slice(0, 160)
            : "model-transport",
        output: text,
      });
      throw error;
    } finally {
      controller.abort();
      signal.removeEventListener("abort", abort);
    }
  };
}
