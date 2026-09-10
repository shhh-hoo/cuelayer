import { coreInterpretationResponse } from '../../server/teaching/core/endpoint.ts';
type Request = { method?: string; body?: unknown; signal?: AbortSignal };
type Response = { setHeader(name: string, value: string): void; status(code: number): { json(body: unknown): void } };
export default async function handler(request: Request, response: Response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') { response.status(405).json({ error: 'method-not-allowed' }); return; }
  const result = await coreInterpretationResponse(request.body, { apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL, signal: request.signal });
  response.status(result.status).json(result.body);
}
