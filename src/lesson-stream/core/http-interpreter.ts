import type { CoreLiveInterpreter, CoreProviderDiagnostic } from './live-session';

/** Only the bounded context crosses HTTP. Local replay/maps remain the acceptance binding. */
export function createHttpCoreInterpreter(fetcher: typeof fetch = fetch): CoreLiveInterpreter {
  return async (binding, { signal, observe }) => {
    const response = await fetcher('/api/teaching/core-interpretation', { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: binding.context }) });
    const body = await response.json() as { proposal?: unknown; diagnostics?: CoreProviderDiagnostic[]; error?: string };
    if (Array.isArray(body.diagnostics)) for (const diagnostic of body.diagnostics) { try { observe(diagnostic); } catch { /* Diagnostic only. */ } }
    if (!response.ok) {
      if (body.error === 'core-provider-output-invalid') throw new SyntaxError(body.error);
      throw new Error(body.error ?? 'core-provider-unavailable');
    }
    return body.proposal;
  };
}
