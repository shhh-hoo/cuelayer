import { afterEach, describe, expect, it, vi } from "vitest";
import { RetryBackoff } from "./retry-backoff";

afterEach(() => vi.useRealTimers());

describe("RetryBackoff", () => {
  it("blocks an immediate pump after a failure until its scheduled retry fires", () => {
    vi.useFakeTimers();
    const retry = new RetryBackoff();
    let interpreterCalls = 0;
    const pump = () => {
      if (retry.active) return;
      interpreterCalls += 1;
    };

    retry.fail(pump);
    pump(); // A newly committed checkpoint must not bypass the retry delay.
    expect(interpreterCalls).toBe(0);
    vi.advanceTimersByTime(999);
    expect(interpreterCalls).toBe(0);
    vi.advanceTimersByTime(1);
    expect(interpreterCalls).toBe(1);
  });

  it("keeps exactly one retry timer while the retry gate is active", () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const retry = new RetryBackoff();
    const pump = vi.fn();

    retry.fail(pump);
    retry.fail(pump);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    expect(pump).toHaveBeenCalledTimes(1);
  });

  it("resets exponential failures after an accepted request", () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const retry = new RetryBackoff();

    retry.fail(() => undefined);
    vi.advanceTimersByTime(1_000);
    retry.accept();
    retry.fail(() => undefined);

    expect(setTimeoutSpy.mock.calls.map(([, delay]) => delay)).toEqual([1_000, 1_000]);
  });
});
