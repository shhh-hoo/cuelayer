/** Bound even a transport/sink that ignores AbortSignal, without unhandled late rejection. */
export function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(new Error(String(signal.reason ?? "cancelled"))); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); })
      .then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
