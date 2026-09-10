import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import handler from './core-interpretation.ts';
import { coreInterpretationResponse } from '../../server/teaching/core/endpoint.ts';
vi.mock('../../server/teaching/core/endpoint.ts', () => ({ coreInterpretationResponse: vi.fn() }));
afterEach(() => vi.resetAllMocks());
it.each([false, true])('server adapter classifies response close only before response completion: ended=%s', async ended => {
  const response = Object.assign(new EventEmitter(), { writableEnded: ended, setHeader: vi.fn(),
    status: vi.fn(() => ({ json: vi.fn() })) });
  let signal: AbortSignal | undefined;
  vi.mocked(coreInterpretationResponse).mockImplementation(async (_body, options) => {
    signal = options.signal;
    response.emit('close');
    return { status: 502, body: { error: 'core-provider-unavailable', diagnostics: [] } };
  });
  await handler({ method: 'POST', body: {} }, response);
  expect(signal!.aborted).toBe(!ended);
  if (!ended) expect(signal!.reason).toBe('client-disconnected');
  expect(response.listenerCount('close')).toBe(0);
});

it('request signal abort maps the server connection to client_disconnect', async () => {
  const controller = new AbortController();
  const response = Object.assign(new EventEmitter(), { writableEnded: false, setHeader: vi.fn(), status: vi.fn(() => ({ json: vi.fn() })) });
  vi.mocked(coreInterpretationResponse).mockImplementation(async (_body, options) => {
    controller.abort();
    expect(options.signal!.reason).toBe('client-disconnected');
    return { status: 502, body: { error: 'core-provider-unavailable', diagnostics: [] } };
  });
  await handler({ method: 'POST', body: {}, signal: controller.signal }, response);
  expect(response.listenerCount('close')).toBe(0);
});
