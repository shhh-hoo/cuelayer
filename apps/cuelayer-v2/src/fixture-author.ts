/** Offline authored-fixture helpers. Never used by the provider or acceptance port. */
import type { Task, Meaning } from "./contract";
import {
  projectMeaning,
  type WireBasis,
  type WireOperation,
} from "./live-wire";

export function authoredRange(
  source: { source: string; text: string },
  quote: string,
  occurrence = 0,
): WireBasis {
  let plain = "",
    end = 0;
  const cuts: { alias: string; offset: number }[] = [];
  for (const match of source.text.matchAll(/<(b\d+)>/g)) {
    plain += source.text.slice(end, match.index);
    cuts.push({ alias: match[1], offset: plain.length });
    end = match.index! + match[0].length;
  }
  plain += source.text.slice(end);
  let at = -1;
  for (let i = 0; i <= occurrence; i++) at = plain.indexOf(quote, at + 1);
  if (at < 0) throw new Error("fixture-source-missing");
  const start =
    cuts.find((c) => c.offset === at) ??
    cuts.find((c) => c.offset < at && !plain.slice(c.offset, at).trim());
  const finish = cuts.find((c) => c.offset === at + quote.length);
  if (!start || !finish) throw new Error("fixture-boundary-missing");
  return { source: source.source, start: start.alias, end: finish.alias };
}
export function fixtureBasis(
  task: Task,
  quote: string,
  source?: string,
): WireBasis[] {
  const entries = task.review
    ? task.review.request.context
    : [task.capture!.request.source, ...task.capture!.request.context];
  for (const entry of entries) {
    if (source && entry.source !== source) continue;
    try {
      return [authoredRange(entry, quote)];
    } catch {
      /* Try another captured source. */
    }
  }
  throw new Error(`fixture-source-missing:${quote}`);
}
export function authoredRevisions(
  id: string,
  previous: Meaning,
  next: Meaning,
  unit: (id: string) => string,
  basis: WireBasis[],
): WireOperation[] {
  if (previous.kind !== next.kind) throw new Error("fixture-kind-change");
  const before = projectMeaning(previous, unit),
    after = projectMeaning(next, unit);
  return Object.entries(after).flatMap(([field, value]) => {
    if (
      field === "kind" ||
      JSON.stringify(value) ===
        JSON.stringify((before as unknown as Record<string, unknown>)[field])
    )
      return [];
    return [
      {
        type: "revise",
        id,
        change: { field: field === "nodes" ? "expression" : field, value },
        basis,
      } as WireOperation,
    ];
  });
}
