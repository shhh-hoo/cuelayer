import { coreInterpretationResponse } from '../../server/teaching/core/endpoint.ts';
type Request = { method?: string; body?: unknown; signal?: AbortSignal };
type Response = { writableEnded?: boolean; on?(event: "close", listener: () => void): void; off?(event: "close", listener: () => void): void; setHeader(name: string, value: string): void; status(code: number): { json(body: unknown): void } };
export default async function handler(request: Request, response: Response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') { response.status(405).json({ error: 'method-not-allowed' }); return; }
  const disconnected = new AbortController();
  const onClose = () => { if (!response.writableEnded) disconnected.abort('client-disconnected'); };
  const onRequestAbort = () => disconnected.abort('client-disconnected');
  if (request.signal?.aborted) onRequestAbort();
  else request.signal?.addEventListener('abort', onRequestAbort, { once: true });
  response.on?.('close', onClose);
  try {
    const result = await coreInterpretationResponse(request.body, { apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL, signal: disconnected.signal });
    response.status(result.status).json(result.body);
  } finally {
    response.off?.('close', onClose);
    request.signal?.removeEventListener('abort', onRequestAbort);
  }
}
