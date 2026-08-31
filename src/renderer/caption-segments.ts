import type { CaptionClip } from "../types";

export type CaptionSegment = { key: string; text: string; wordId?: string };

/** Splits the authored caption around timed words without inventing or dropping spacing. */
export function captionSegments(clip: CaptionClip): CaptionSegment[] {
  let cursor = 0;
  const segments: CaptionSegment[] = [];
  clip.words.forEach((word) => {
    const index = clip.captionText.indexOf(word.text, cursor);
    if (index < 0) throw new Error(`Timed word ${word.id} is not present in caption text.`);
    if (index > cursor) segments.push({ key: `text-${cursor}`, text: clip.captionText.slice(cursor, index) });
    segments.push({ key: word.id, text: word.text, wordId: word.id });
    cursor = index + word.text.length;
  });
  if (cursor < clip.captionText.length) segments.push({ key: `text-${cursor}`, text: clip.captionText.slice(cursor) });
  return segments;
}

export function captionTextForMode(clip: CaptionClip, _: "plain" | "fx"): string {
  return clip.captionText;
}
