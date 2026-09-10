import type { InterpretationContext } from '../../../src/lesson-stream/core/interpretation-context.ts';
import { CORE_CONTEXT_BUDGETS, CORE_CONTEXT_VERSION } from '../../../src/lesson-stream/core/interpretation-context.ts';
import { interpretationDeadlines } from '../../../src/lesson-stream/runtime-policy.ts';
import type { CoreProviderDiagnostic } from '../../../src/lesson-stream/core/live-session.ts';
import { sanitizeTraceValue } from '../../../src/trace/contracts.ts';
import { interpretCore, openAICoreTransport, type CoreProviderTransport } from './openai-interpreter.ts';
import { coreAbortSource } from '../../../src/lesson-stream/core/diagnostics.ts';

export type CoreEndpointOptions = { apiKey?: string; model?: string; transport?: CoreProviderTransport; signal?: AbortSignal };
export async function coreInterpretationResponse(body: unknown, options: CoreEndpointOptions) {
  const startedAt = new Date().toISOString(), started = performance.now();
  const diagnostics: CoreProviderDiagnostic[] = [];
  const record = (diagnostic: CoreProviderDiagnostic) => { try { diagnostics.push(sanitizeTraceValue(diagnostic) as CoreProviderDiagnostic); } catch { /* Diagnostic only. */ } };
  const context = body && typeof body === 'object' && 'context' in body ? body.context as InterpretationContext : undefined;
  if (!context || context.version !== CORE_CONTEXT_VERSION || !Array.isArray(context.evidence) || !Array.isArray(context.entities)
    || !context.knowledge || !context.cue || JSON.stringify(context).length > CORE_CONTEXT_BUDGETS.maxCharacters) {
    record({ stage: 'endpoint', startedAt, completedAt: new Date().toISOString(), elapsedMs: performance.now() - started, outcome: 'failure' });
    return { status: 400, body: { error: 'core-context-invalid', diagnostics } };
  }
  if (!options.apiKey && !options.transport) {
    record({ stage: 'endpoint', startedAt, completedAt: new Date().toISOString(), elapsedMs: performance.now() - started, outcome: 'failure', abortSource: 'provider_transport_failure' });
    return { status: 503, body: { error: 'core-provider-not-configured', diagnostics } };
  }
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort('core-provider-timeout'), interpretationDeadlines().providerMs);
  const model = options.model || 'gpt-5.6-luna';
  try {
    const binding = { context };
    const result = await interpretCore(binding, model, options.transport ?? openAICoreTransport(options.apiKey!), signal,
      diagnostic => record({ stage: 'response', ...diagnostic }), record);
    record({ stage: 'endpoint', startedAt, completedAt: new Date().toISOString(), elapsedMs: performance.now() - started, outcome: 'success' });
    return { status: 200, body: { proposal: result.proposal, diagnostics } };
  } catch (error) {
    record({ stage: 'endpoint', startedAt, completedAt: new Date().toISOString(), elapsedMs: performance.now() - started, outcome: 'failure',
      abortSource: coreAbortSource(signal, error) });
    const reason = controller.signal.aborted ? 'core-provider-timeout' : error instanceof SyntaxError || error instanceof Error && error.name === 'ZodError'
      ? 'core-provider-output-invalid' : 'core-provider-unavailable';
    return { status: 502, body: { error: reason, diagnostics } };
  } finally { clearTimeout(timer); }
}
