import { createSpeechmaticsJWT } from "@speechmatics/auth";

type Response = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void };
};

/** Vercel-compatible server endpoint. The permanent API key never enters the browser bundle. */
export default async function handler(request: { method?: string }, response: Response): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.status(405).json({ error: "method-not-allowed" });
    return;
  }
  const apiKey = process.env.SPEECHMATICS_API_KEY;
  if (!apiKey) {
    response.status(503).json({ error: "speech-not-configured" });
    return;
  }
  try {
    const token = await createSpeechmaticsJWT({ type: "rt", apiKey, ttl: 60 });
    response.status(200).json({ token });
  } catch {
    response.status(502).json({ error: "speech-token-unavailable" });
  }
}
