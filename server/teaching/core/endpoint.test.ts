import { expect, it, vi } from 'vitest';
import { coreInterpretationResponse } from './endpoint.ts';
import { createHttpCoreInterpreter } from '../../../src/lesson-stream/core/http-interpreter.ts';
import { CoreLiveSession } from '../../../src/lesson-stream/core/live-session.ts';
import { MemoryCoreStore, closedSpan, proposalFor } from '../../../src/lesson-stream/core/live-test-fixtures.ts';
import { buildCoreInterpretationContext } from '../../../src/lesson-stream/core/interpretation-context.ts';
import { CoreLessonStreamRuntime } from '../../../src/lesson-stream/core/runtime.ts';
async function binding() {
  const runtime = await CoreLessonStreamRuntime.open('endpoint-test', new MemoryCoreStore());
  await runtime.start(); await runtime.commitClosedSpan(closedSpan(), 0);
  return buildCoreInterpretationContext(runtime.replay, { requestId: 'request', newEvidence: runtime.pending });
}
it('bounded HTTP context traverses the existing server envelope/parser, then local validation and durable acceptance', async () => {
  const transport = vi.fn(async request => {
    const context = JSON.parse(request.input[1].content);
    return { output_text: JSON.stringify(proposalFor({ context }, true)), status: 'completed', model: 'injected' };
  });
  const fetcher = vi.fn(async (_url, options) => {
    const body = JSON.parse(options.body);
    expect(Object.keys(body)).toEqual(['context']);
    const result = await coreInterpretationResponse(body, { transport });
    return { ok: result.status === 200, json: async () => result.body };
  });
  const trace = vi.fn();
  const live = await CoreLiveSession.open({ sessionId: 'http', lessonDomain: 'core', speechRunId: 0,
    store: new MemoryCoreStore(), interpreter: createHttpCoreInterpreter(fetcher as unknown as typeof fetch), trace });
  await live.commitClosedSpan(closedSpan()); await live.currentAttempt;
  expect(live.state.knowledge.revision).toBe(1); expect(live.state.processedThroughSequence).toBe(1);
  const types = trace.mock.calls.map(([draft]) => draft.type);
  for (const type of ['core.request', 'core.provider_request', 'core.provider_response', 'core.proposal_normalized', 'core.validation', 'core.accepted', 'core.published']) expect(types).toContain(type);
  expect(types.indexOf('core.accepted')).toBeLessThan(types.indexOf('core.published'));
  expect(transport).toHaveBeenCalledTimes(1); live.close();
});
it('missing configuration, invalid or over-budget input makes no transport call', async () => {
  const transport = vi.fn();
  expect((await coreInterpretationResponse({}, { transport })).status).toBe(400);
  const request = { context: (await binding()).context };
  expect((await coreInterpretationResponse(request, {})).status).toBe(503);
  request.context.structuralPriors = ['x'.repeat(32_001)];
  expect((await coreInterpretationResponse(request, { transport })).status).toBe(400);
  expect(transport).not.toHaveBeenCalled();
});
it.each(['bad json', '{"outcome":{"kind":"bad"}}'])('invalid provider output rejects and preserves response diagnostics: %s', async output_text => {
  const result = await coreInterpretationResponse({ context: (await binding()).context }, { transport: async () => ({ output_text }) });
  expect(result.status).toBe(502); expect(result.body.error).toBe('core-provider-output-invalid');
  expect(result.body.diagnostics.map(d => d.stage)).toEqual(['request', 'response']);
});
it('HTTP invalid output remains a validation failure for the scheduler', async () => {
  const request = await binding();
  const interpreter = createHttpCoreInterpreter(vi.fn(async () => ({ ok: false, json: async () => ({ error: 'core-provider-output-invalid' }) })) as unknown as typeof fetch);
  await expect(interpreter(request, { signal: new AbortController().signal, observe: vi.fn() })).rejects.toBeInstanceOf(SyntaxError);
});
