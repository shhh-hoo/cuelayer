import { coreAbortSource, type CoreAbortSource } from './diagnostics';
import type { CoreLiveInterpreter, CoreProviderDiagnostic } from './live-session';

/** Only the bounded context crosses HTTP. Local replay/maps remain the acceptance binding. */
export function createHttpCoreInterpreter(fetcher: typeof fetch = fetch): CoreLiveInterpreter {
  return async (binding, { signal, observe }) => {
    const startedAt = new Date().toISOString(), started = performance.now();
    let outcome: "success" | "failure" = "failure";
    let failure: unknown;
    let remoteAbortSource: CoreAbortSource | undefined;
    const record: typeof observe = diagnostic => { try { observe(diagnostic); } catch { /* Diagnostic only. */ } };
    try {
      const response = await fetcher('/api/teaching/core-interpretation', { method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: binding.context }) });
      const body = await response.json() as { proposal?: unknown; diagnostics?: CoreProviderDiagnostic[]; error?: string };
      if (Array.isArray(body.diagnostics)) for (const diagnostic of body.diagnostics) {
        try {
          if (diagnostic.stage === 'endpoint') remoteAbortSource = diagnostic.abortSource;
          record(diagnostic);
        } catch { /* Malformed diagnostics cannot change the HTTP result. */ }
      }
      if (!response.ok) {
        if (body.error === 'core-provider-output-invalid') throw new SyntaxError(body.error);
        throw new Error(body.error ?? 'core-provider-unavailable');
      }
      outcome = "success";
      return body.proposal;
    } catch (error) { failure = error; throw error; }
    finally { record({ stage: "http", startedAt, completedAt: new Date().toISOString(), elapsedMs: performance.now() - started,
      outcome, ...(outcome === "failure" ? { abortSource: signal.aborted ? coreAbortSource(signal) : remoteAbortSource ?? coreAbortSource(undefined, failure) } : {}) }); }
  };
}
