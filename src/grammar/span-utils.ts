import type { CaptionSpanRef, GroundedCaption, Transcript, TranscriptToken } from "./types";

export function transcriptText(transcript: Transcript): string {
  return transcript.tokens.map((token) => `${token.joinerBefore}${token.text}`).join("");
}

export function getSpanTokens(transcript: Transcript, tokenIds: string[]): TranscriptToken[] {
  const byId = new Map(transcript.tokens.map((token) => [token.id, token]));
  return tokenIds.map((id) => {
    const token = byId.get(id);
    if (!token) throw new Error(`Unknown transcript token \"${id}\" in ${transcript.id}.`);
    return token;
  });
}

export function tokenSpanText(transcript: Transcript, tokenIds: string[]): string {
  return getSpanTokens(transcript, tokenIds).map((token, index) => `${index === 0 ? "" : token.joinerBefore}${token.text}`).join("");
}

export function makeTranscript(id: string, line: string, tokenDurationMs = 260): Transcript {
  const matches = [...line.matchAll(/\S+/g)];
  return {
    id,
    tokens: matches.map((match, index) => ({
      id: `${id}-${index + 1}`,
      text: match[0],
      joinerBefore: index === 0 ? line.slice(0, match.index) : line.slice((matches[index - 1].index ?? 0) + matches[index - 1][0].length, match.index),
      startMs: index * tokenDurationMs,
      endMs: (index + 1) * tokenDurationMs,
    })),
  };
}

export function speechTokenIds(transcript: Transcript, startIndex: number, endIndex: number): string[] {
  const tokens = transcript.tokens.slice(startIndex, endIndex);
  if (!tokens.length) throw new Error(`Cannot create an empty span for ${transcript.id}.`);
  return tokens.map((token) => token.id);
}

export function groundedCaptionText(caption: GroundedCaption): string {
  return caption.fragments.map((fragment) => fragment.text).join("");
}

export function captionSpan(fragmentId: string, text: string, startOffset = 0, endOffset = text.length): CaptionSpanRef {
  return { fragmentId, startOffset, endOffset, exactText: text.slice(startOffset, endOffset) };
}
