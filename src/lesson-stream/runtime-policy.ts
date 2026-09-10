/** Conservative dogfood bounds; no context is silently truncated to satisfy them. */
export const PROVIDER_DEADLINE_MS = 6_000;
export const TRANSPORT_GRACE_MS = 2_000;
export const MAX_REQUEST_CHECKPOINTS = 2;
export const MAX_PROJECTED_INPUT_TOKENS = 24_000;
export const OUTPUT_RESERVE_TOKENS = 2_048;
// Includes policy and expanded JSON schema. Server checks exact envelope too.
export const PROVIDER_ENVELOPE_RESERVE_TOKENS = 12_000;
export function interpretationDeadlines(diagnosticMs?: string, development = false) {
  const requested = Number(diagnosticMs);
  const providerMs = development && Number.isFinite(requested) && requested >= 6_000 && requested <= 60_000 ? requested : PROVIDER_DEADLINE_MS;
  return { providerMs, clientMs: providerMs + TRANSPORT_GRACE_MS };
}
export type InterpretationFailure = "validation" | "provider" | "timeout" | "cancelled" | "conflict" | "budget";
export function classifyInterpretationFailure(message: string, cancelled = false, timedOut = false): InterpretationFailure {
  if (cancelled) return "cancelled";
  if (timedOut || message.includes("timeout")) return "timeout";
  if (message === "interpretation-state-conflict") return "conflict";
  if (message.includes("budget")) return "budget";
  if (message.startsWith("proposal-") || message.includes("structured-parse") || message.includes("normalization")) return "validation";
  return "provider";
}
