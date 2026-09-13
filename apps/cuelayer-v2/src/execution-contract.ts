import type { Task } from "./contract";
import type { LiveRequest } from "./projection";
import type { StageRequest } from "./stage";

export type CapturedRequest = Readonly<{
  taskId: string;
  lane: "Live" | "Stage";
  request: LiveRequest | StageRequest;
}>;
export type ProviderCompletion = {
  completed: boolean;
  terminalType: string | null;
  actualModel: string | null;
  responseId: string | null;
  usage: unknown;
};
export type ExecutionResult = {
  attemptId: string;
  proposal: unknown;
  outputText: string;
  provider: ProviderCompletion;
};
export type ExecutionObservation = {
  phase: string;
  at: number;
  clockId: string;
  details: Readonly<Record<string, unknown>>;
};
export type ObservationOptions = {
  observe?: (event: ExecutionObservation) => void | Promise<void>;
  now?: () => number;
  clockId?: string;
};
export function deliverObservation(
  options: ObservationOptions,
  event: ExecutionObservation,
) {
  try {
    const pending = options.observe?.(event);
    if (pending) void Promise.resolve(pending).catch(() => {});
  } catch {
    /* Observation never changes execution or acceptance. */
  }
}
/** Observations may enqueue work, but asynchronous sinks are never awaited. */
export function executionObserver(options: ObservationOptions = {}) {
  const now = options.now ?? (() => performance.now());
  const clockId = options.clockId ?? `monotonic:${performance.timeOrigin}`;
  return (phase: string, details: Record<string, unknown> = {}) => {
    try {
      deliverObservation(options, { phase, at: now(), clockId, details });
    } catch {
      /* Observation never changes execution or acceptance. */
    }
  };
}
export class ExecutionFailure extends Error {
  attemptId: string | null = null;
  outputText = "";
  provider: ProviderCompletion | null = null;
}
export class TransientFailure extends ExecutionFailure {}
export type Interpreter = (
  task: Task,
  signal: AbortSignal,
  firstUseful: () => void,
) => Promise<unknown>;
export type ExecutionTransport = (
  captured: CapturedRequest,
  signal: AbortSignal,
) => Promise<Response>;
