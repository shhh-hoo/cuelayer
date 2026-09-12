import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { profile } from "./contract.mjs";

export function fidelity(rows, duration_ms, elapsed_ms) {
  const delays = rows
    .map((r) => r.evaluator_dispatch_at - r.scheduled_at)
    .sort((a, b) => a - b);
  const p95 =
      delays[Math.max(0, Math.ceil(delays.length * 0.95) - 1)] ?? Infinity,
    max = delays.at(-1) ?? Infinity;
  return {
    status:
      p95 <= profile.driver_lateness.p95_ms &&
      max <= profile.driver_lateness.max_ms &&
      elapsed_ms >= duration_ms
        ? "PASS"
        : "INVALID",
    p95_ms: p95,
    max_ms: max,
    duration_ms,
    elapsed_ms,
    count: rows.length,
    owner_layer: "A",
    boundary: "scheduled-to-dispatch",
  };
}
// Absolute deadlines in a dedicated worker; callbacks never wait for page/model/admission.
// Dispatch is measured when the main transport enqueues the page message, so evaluator
// congestion after the worker wake-up is still evaluator lateness, not product latency.
if (!isMainThread && workerData?.gate3bDriver) {
  const { events, duration_ms } = workerData;
  const start = performance.timeOrigin + performance.now();
  for (const event of events) {
    const scheduled_at = start + event.at_ms;
    while (performance.timeOrigin + performance.now() < scheduled_at)
      await new Promise((r) =>
        setTimeout(
          r,
          Math.max(
            1,
            scheduled_at - (performance.timeOrigin + performance.now()),
          ),
        ),
      );
    const evaluator_dispatch_at = performance.timeOrigin + performance.now();
    parentPort.postMessage({
      type: "event",
      ...event,
      scheduled_at,
      evaluator_dispatch_at,
    });
  }
  while (performance.timeOrigin + performance.now() < start + duration_ms)
    await new Promise((r) =>
      setTimeout(
        r,
        Math.max(
          1,
          start + duration_ms - (performance.timeOrigin + performance.now()),
        ),
      ),
    );
  parentPort.postMessage({
    type: "complete",
    start,
    end: performance.timeOrigin + performance.now(),
  });
}
export function drive(events, duration_ms, dispatch) {
  return new Promise((resolve, reject) => {
    const rows = [],
      pending = [],
      worker = new Worker(new URL(import.meta.url), {
        execArgv: [],
        workerData: { gate3bDriver: true, events, duration_ms },
      });
    worker.on("error", reject);
    worker.on("message", async (row) => {
      if (row.type === "event") {
        row.worker_awake_at = row.evaluator_dispatch_at;
        row.evaluator_dispatch_at = performance.timeOrigin + performance.now();
        rows.push(row);
        pending.push(
          Promise.resolve(dispatch?.(row)).then((x) =>
            Object.assign(row, x ?? {}),
          ),
        );
      } else if (row.type === "complete") {
        try {
          await Promise.all(pending);
          resolve({
            rows,
            start: row.start,
            end: row.end,
            fidelity: fidelity(rows, duration_ms, row.end - row.start),
          });
        } catch (error) {
          reject(error);
        }
      }
    });
  });
}
