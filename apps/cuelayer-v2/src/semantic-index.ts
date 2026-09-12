import type { TeachingState, Unit, Evidence } from "./contract";
import { position, type SourceRange } from "./source";
const terms = (text: string) =>
  new Set(text.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}_]+/gu) ?? []);
/** Disposable copy-on-write index. Global index changes never become inspection identity. */
class SemanticIndex {
  documents = new Map<string, { version: number; terms: Set<string> }>();
  postings = new Map<string, Set<string>>();
  reverse = new Map<string, Set<string>>();
  constructor(
    readonly state: TeachingState,
    prior?: SemanticIndex,
  ) {
    if (prior) {
      this.documents = new Map(prior.documents);
      this.postings = new Map(prior.postings);
      this.reverse = new Map(prior.reverse);
    }
    for (const u of Object.values(state.units)) {
      if (this.documents.get(u.id)?.version === u.version) continue;
      const previous = prior?.state.units[u.id];
      for (const term of this.documents.get(u.id)?.terms ?? []) {
        const ids = new Set(this.postings.get(term));
        ids.delete(u.id);
        this.postings.set(term, ids);
      }
      for (const target of references(previous)) {
        const ids = new Set(this.reverse.get(target));
        ids.delete(u.id);
        this.reverse.set(target, ids);
      }
      const tokens = terms(JSON.stringify(u.meaning));
      this.documents.set(u.id, { version: u.version, terms: tokens });
      for (const term of tokens)
        this.postings.set(
          term,
          new Set([...(this.postings.get(term) ?? []), u.id]),
        );
      for (const target of references(u))
        this.reverse.set(
          target,
          new Set([...(this.reverse.get(target) ?? []), u.id]),
        );
    }
  }
  search(query: string) {
    const scores = new Map<string, number>();
    for (const word of terms(query))
      for (const id of this.postings.get(word) ?? [])
        scores.set(id, (scores.get(id) ?? 0) + 1);
    return [...scores]
      .filter(([id]) => this.state.units[id]?.valid)
      .sort(
        (a, b) =>
          b[1] - a[1] || a[0].localeCompare(b[0], "en", { numeric: true }),
      )
      .map(([id]) => id);
  }
  overlaps(evidence: Evidence[], range: SourceRange) {
    const lo = position(evidence, range.start),
      hi = position(evidence, range.end);
    return Object.values(this.state.units)
      .filter(
        (u) =>
          u.valid &&
          u.basis.some(
            (b) =>
              b.range &&
              position(evidence, b.range.start) < hi &&
              position(evidence, b.range.end) > lo,
          ),
      )
      .map((u) => u.id);
  }
}
export function references(u?: Unit): string[] {
  return u
    ? [
        ...new Set([
          ...u.requires,
          ...(u.meaning.kind === "relation"
            ? u.meaning.targets
            : u.meaning.kind === "annotation"
              ? [u.meaning.target]
              : []),
        ]),
      ]
    : [];
}
const indexes = new WeakMap<TeachingState, SemanticIndex>();
export function semanticIndex(state: TeachingState) {
  let index = indexes.get(state);
  if (!index) {
    index = new SemanticIndex(state);
    indexes.set(state, index);
  }
  return index;
}
export function indexSemanticTransition(
  previous: TeachingState,
  next: TeachingState,
) {
  if (next !== previous)
    indexes.set(next, new SemanticIndex(next, semanticIndex(previous)));
}

/** Rank bounded source pieces by uncommon shared lexical terms, without interpreting their claims. */
export function relatedSourceText(
  primary: string,
  pieces: string[],
  limit = 2,
) {
  const query = terms(primary),
    docs = pieces.map((text) => ({ text, terms: terms(text) }));
  // Numeric/symbol identifiers are stronger retrieval keys than repeated connective wording.
  const weight = (word: string) =>
    (/\d/u.test(word) ? 3 : 1) *
    Math.log(
      1 + docs.length / (1 + docs.filter((d) => d.terms.has(word)).length),
    );
  return docs
    .filter((d) => d.text.trim() !== primary.trim())
    .map((d) => ({
      ...d,
      score: [...query]
        .filter((word) => d.terms.has(word))
        .reduce((sum, word) => sum + weight(word), 0),
    }))
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((d) => d.text)
    .join(" ");
}
