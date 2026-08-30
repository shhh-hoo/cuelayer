import type { CaptionToken, SpanRef, Transcript } from "./types";

export function transcriptText(transcript: Transcript): string {
  return transcript.tokens.map((token) => token.text).join(" ");
}

export function getSpanTokens(transcript: Transcript, span: SpanRef): CaptionToken[] {
  const byId = new Map(transcript.tokens.map((token) => [token.id, token]));
  return span.tokenIds.map((id) => {
    const token = byId.get(id);
    if (!token) throw new Error(`Unknown transcript token \"${id}\" in ${transcript.id}.`);
    return token;
  });
}

export function spanText(transcript: Transcript, span: SpanRef): string {
  return getSpanTokens(transcript, span).map((token) => token.text).join(" ");
}

export function makeTranscript(id: string, line: string, tokenDurationMs = 260): Transcript {
  return {
    id,
    tokens: line.split(/\s+/).map((text, index) => ({
      id: `${id}-${index + 1}`,
      text,
      startMs: index * tokenDurationMs,
      endMs: (index + 1) * tokenDurationMs,
    })),
  };
}

export function spanFromRange(transcript: Transcript, startIndex: number, endIndex: number): SpanRef {
  const tokens = transcript.tokens.slice(startIndex, endIndex);
  if (!tokens.length) throw new Error(`Cannot create an empty span for ${transcript.id}.`);
  return { tokenIds: tokens.map((token) => token.id), exactText: tokens.map((token) => token.text).join(" ") };
}
