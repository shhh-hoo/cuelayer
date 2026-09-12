import type { Evidence } from "./contract";

export type SourceCursor = {
  evidenceId: string | null;
  sequence: number;
  offset: number;
};
export type SourceRange = { start: SourceCursor; end: SourceCursor };
export const ORIGIN: SourceCursor = {
  evidenceId: null,
  sequence: 0,
  offset: 0,
};
export const BOUNDARY_VERSION = "v2-lexical-boundaries-1";
// Disposable exact prefix index, rebuilt on replay. Evidence identity remains the durable authority.
const prefixIndexes = new WeakMap<Evidence[], number[]>();
function prefix(evidence: Evidence[]) {
  let offsets = prefixIndexes.get(evidence);
  if (!offsets) {
    offsets = [0];
    for (const e of evidence) offsets.push(offsets.at(-1)! + e.text.length);
    prefixIndexes.set(evidence, offsets);
  }
  return offsets;
}
export function indexAppend(previous: Evidence[], next: Evidence[]) {
  const offsets = prefix(previous);
  prefixIndexes.set(next, [
    ...offsets,
    offsets.at(-1)! + next.at(-1)!.text.length,
  ]);
}
export function codePointBoundary(text: string, offset: number) {
  return (
    Number.isInteger(offset) &&
    offset >= 0 &&
    offset <= text.length &&
    !(
      offset > 0 &&
      offset < text.length &&
      /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
      /[\uDC00-\uDFFF]/.test(text[offset])
    )
  );
}
/** Fixed lexical cuts only: whitespace, punctuation, ideographs. No sentence/meaning inference. */
export function lexicalBoundaries(text: string): number[] {
  const cuts = new Set([0, text.length]);
  let i = 0;
  for (const c of text) {
    const end = i + c.length;
    if (
      /[\s\p{P}\p{S}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
        c,
      )
    ) {
      cuts.add(i);
      cuts.add(end);
    }
    i = end;
  }
  return [...cuts].sort((a, b) => a - b);
}
export function position(evidence: Evidence[], cursor: SourceCursor): number {
  if (
    cursor.sequence === 0 &&
    cursor.evidenceId === null &&
    cursor.offset === 0
  )
    return 0;
  const e = evidence[cursor.sequence - 1];
  if (
    !e ||
    e.id !== cursor.evidenceId ||
    !codePointBoundary(e.text, cursor.offset)
  )
    throw new Error("invalid-source-cursor");
  return prefix(evidence)[cursor.sequence - 1] + cursor.offset;
}
export function cursorAt(evidence: Evidence[], offset: number): SourceCursor {
  if (offset === 0) return { ...ORIGIN };
  const offsets = prefix(evidence);
  let lo = 1,
    hi = evidence.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsets[mid] >= offset) hi = mid;
    else lo = mid + 1;
  }
  const e = evidence[lo - 1],
    local = offset - offsets[lo - 1];
  if (e && codePointBoundary(e.text, local))
    return { evidenceId: e.id, sequence: e.sequence, offset: local };
  throw new Error("invalid-source-position");
}
export function recorded(evidence: Evidence[]): SourceCursor {
  const last = evidence.at(-1);
  return last
    ? { evidenceId: last.id, sequence: last.sequence, offset: last.text.length }
    : { ...ORIGIN };
}
export function sourcePieces(evidence: Evidence[], range: SourceRange) {
  const start = position(evidence, range.start),
    end = position(evidence, range.end);
  if (end < start) throw new Error("reversed-source-range");
  const offsets = prefix(evidence);
  return evidence
    .slice(Math.max(0, range.start.sequence - 1), range.end.sequence)
    .flatMap((e) => {
      const at = offsets[e.sequence - 1];
      const lo = Math.max(0, start - at),
        hi = Math.min(e.text.length, end - at);
      return hi > lo
        ? [
            {
              evidenceId: e.id,
              sequence: e.sequence,
              start: lo,
              end: hi,
              text: e.text.slice(lo, hi),
            },
          ]
        : [];
    });
}
export const rangeSize = (e: Evidence[], r: SourceRange) =>
  position(e, r.end) - position(e, r.start);
export function separator(left: string, right: string) {
  if (
    !left ||
    !right ||
    /\s$/.test(left) ||
    /^[\s\p{P}]/u.test(right) ||
    (/\p{Script=Han}$/u.test(left) && /^\p{Script=Han}/u.test(right))
  )
    return "";
  return " ";
}
/** Presentation spaces have no source identity. Every character of evidence stays exact. */
export function readable(evidence: Evidence[], range: SourceRange) {
  return sourcePieces(evidence, range).reduce(
    (out, p) => out + separator(out, p.text) + p.text,
    "",
  );
}
export function legalCursors(evidence: Evidence[], range: SourceRange) {
  const lo = position(evidence, range.start),
    hi = position(evidence, range.end);
  const offsets = prefix(evidence);
  const positions = new Set([lo]);
  for (const e of evidence.slice(
    Math.max(0, range.start.sequence - 1),
    range.end.sequence,
  )) {
    const at = offsets[e.sequence - 1];
    for (const cut of evidenceBoundaries(e))
      if (at + cut > lo && at + cut <= hi) positions.add(at + cut);
  }
  return [...positions].sort((a, b) => a - b).map((n) => cursorAt(evidence, n));
}
export function boundedRange(
  evidence: Evidence[],
  start: SourceCursor,
  chars: number,
): SourceRange {
  const end = recorded(evidence),
    lo = position(evidence, start);
  const cuts = legalCursors(evidence, { start, end });
  const last = cuts.filter((c) => position(evidence, c) - lo <= chars).at(-1)!;
  if (position(evidence, last) === lo && position(evidence, end) > lo)
    throw new Error("context-blocked:indivisible-source");
  return { start, end: last };
}

export function evidenceBoundaries(e: Evidence) {
  const b = e.alignment?.boundaries;
  if (
    b?.length &&
    b[0] === 0 &&
    b.at(-1) === e.text.length &&
    b.every((n, i) => codePointBoundary(e.text, n) && (i === 0 || n > b[i - 1]))
  )
    return b;
  return lexicalBoundaries(e.text);
}
