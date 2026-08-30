import type { CaptionClip, CueTarget, EffectCue } from "../types";

export function cueTargets(cue: EffectCue): CueTarget[] {
  if (cue.kind === "FOCUS") return [cue.target];
  if (cue.kind === "RELATE") return cue.targets;
  return [cue.from, cue.to];
}

export function targetText(clip: CaptionClip, target: CueTarget): string {
  return clip.words.filter((word) => target.wordIds.includes(word.id)).map((word) => word.text).join(" ");
}

export function targetDisplayText(clip: CaptionClip, target: CueTarget): string {
  return target.displayText ?? targetText(clip, target);
}

export type PhraseSegment = { key: string; text: string; target?: CueTarget };

/** Keeps authored spacing intact while combining contiguous target words into one phrase wrapper. */
export function phraseSegments(clip: CaptionClip, targets: CueTarget[]): PhraseSegment[] {
  const targetStarts = new Map(targets.map((target) => [target.wordIds[0], target]));
  const wordIndex = new Map(clip.words.map((word, index) => [word.id, index]));
  const segments: PhraseSegment[] = [];
  let cursor = 0;

  for (let index = 0; index < clip.words.length; index += 1) {
    const word = clip.words[index];
    const target = targetStarts.get(word.id);
    const lastId = target?.wordIds.at(-1);
    const lastIndex = lastId ? wordIndex.get(lastId) : undefined;
    if (!target || lastIndex === undefined || lastIndex < index) {
      const start = clip.captionText.indexOf(word.text, cursor);
      if (start > cursor) segments.push({ key: `text-${cursor}`, text: clip.captionText.slice(cursor, start) });
      segments.push({ key: word.id, text: word.text });
      cursor = start + word.text.length;
      continue;
    }

    const start = clip.captionText.indexOf(word.text, cursor);
    if (start > cursor) segments.push({ key: `text-${cursor}`, text: clip.captionText.slice(cursor, start) });
    const lastWord = clip.words[lastIndex];
    const end = clip.captionText.indexOf(lastWord.text, start) + lastWord.text.length;
    segments.push({ key: target.id, text: clip.captionText.slice(start, end), target });
    cursor = end;
    index = lastIndex;
  }

  if (cursor < clip.captionText.length) segments.push({ key: `text-${cursor}`, text: clip.captionText.slice(cursor) });
  return segments;
}
