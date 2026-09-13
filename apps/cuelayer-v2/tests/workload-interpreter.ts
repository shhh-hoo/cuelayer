/** Bounded synthetic interpreter. Its only input is the actual provider request. No script, clock, full host state or cross-page memory. */
import type { LiveRequest } from "../src/projection";
import type { StageRequest } from "../src/stage";
import type { StageDeclarationReview } from "../src/stage-wire";
import type {
  LiveDecision,
  WireOperation,
  WireBasis,
  WireMeaning,
} from "../src/live-wire";
import { authoredPut, authoredRange } from "../src/fixture-author";
const plain = (text: string) => text.replace(/<b\d+>/g, "");
const whole = (s: { source: string; text: string }): WireBasis => ({
  source: s.source,
  start: s.text.match(/<(b\d+)>/)![1],
  end: [...s.text.matchAll(/<(b\d+)>/g)].at(-1)![1],
});
function known(units: LiveRequest["units"]) {
  return new Map(
    units
      .filter((u) => u.valid && u.meaning.kind === "quantity")
      .map((u) => [
        Number(
          (
            u.meaning as Extract<WireMeaning, { kind: "quantity" }>
          ).symbols[0].symbol.slice(1),
        ),
        u.id,
      ]),
  );
}
export function interpretWorkload(
  request: LiveRequest | StageRequest,
): LiveDecision | StageDeclarationReview {
  if (request.version === "v2-stage-request-5") {
    const samples = known(request.units);
    return {
      scope: request.scope,
      results: request.items.map((item) => {
        const original = request.context.find((c) => c.source === item.source)!;
        const match = plain(original.text).match(
          /Review (\d+): that sample follows (\d+)\. END\./,
        );
        if (!match) return { item: item.id, outcome: "STILL_OPEN" as const };
        const clue = request.context
          .map((c) => ({
            source: c,
            match: plain(c.text).match(
              new RegExp(`Identify ${match[1]} as (\\d+)\\. END\\.`),
            ),
          }))
          .find((c) => c.match);
        const target = clue?.match
            ? samples.get(Number(clue.match[1]))
            : undefined,
          prior = samples.get(Number(match[2]));
        if (
          !clue?.match ||
          !target ||
          !prior ||
          !item.core ||
          !request.createWithin.includes(item.core)
        )
          return { item: item.id, outcome: "STILL_OPEN" as const };
        const basis = [
          whole(original),
          authoredRange(clue.source, clue.match[0]),
        ];
        return {
          item: item.id,
          outcome: "RESOLVED" as const,
          referents: [target],
          declarations: [
            {
              action: "ADD" as const,
              meaning: {
                kind: "relation" as const,
                relation: "dependency" as const,
                targets: [target, prior],
                text: `Sample ${clue.match[1]} follows sample ${match[2]}.`,
              },
              about: [],
              usesValue: [],
              basis,
            },
          ],
        };
      }),
    };
  }
  const r = request,
    samples = known(r.units),
    text = plain(r.source.text);
  const response: LiveDecision = {
    scope: r.scope,
    groups: [],
    suffixStatus: "NONE",
    contextRequest: null,
    reviewRequests: [],
    attentionCandidate: null,
  };
  let core = r.currentCore ?? r.cores[0]?.id,
    slot = 0,
    last = 0;
  const waitFor = (query: string, purpose: "READ" | "MODIFY") => {
    response.suffixStatus = "WAIT_MORE_INPUT";
    response.contextRequest = { query, purpose, after: null };
    return response;
  };
  const records = [
    ...text.matchAll(
      /(?:Fact|Correct|Carry|Bind|Review|Identify|Ask:|Compare)[\s\S]*?END\./g,
    ),
  ];
  for (const record of records) {
    const sentence = record[0],
      basis = [authoredRange(r.source, sentence)],
      throughBoundary = basis[0].end;
    let operations: WireOperation[] = [],
      resolutions: Extract<
        LiveDecision["groups"][number],
        { outcome: "APPLY" }
      >["resolutions"] = [];
    let m: RegExpMatchArray | null;
    if ((m = sentence.match(/^(Fact|Correct) (\d+): (p\d+)=(\d+) kPa/))) {
      const sample = Number(m[2]),
        id = samples.get(sample),
        value = Number(m[4]);
      if (m[1] === "Correct") {
        if (!id || (!r.writableUnits.includes(id) && !r.newUnits.includes(id)))
          return waitFor(m[3], "MODIFY");
        operations.push({
          type: "revise",
          id,
          change: {
            field: "expression",
            value: [m[3], value, { operator: "Equal", operands: [0, 1] }],
          },
          basis,
        });
      } else if (!id) {
        if (!core) {
          core = r.newCores[0];
          operations.push(
            { type: "core", id: core, label: "Laboratory samples", basis },
            { type: "mainline", coreId: core, basis },
          );
        }
        const id = r.newUnits[slot++];
        samples.set(sample, id);
        operations.push(
          authoredPut({
            type: "put",
            id,
            coreId: core,
            meaning: {
              kind: "quantity",
              nodes: [m[3], value, { operator: "Equal", operands: [0, 1] }],
              symbols: [
                { symbol: m[3], label: `Sample ${m[2]} pressure`, unit: "kPa" },
              ],
              conditions: ["at fixed temperature"],
              independent: null,
              domain: null,
            },
            dependencies: [],
            basis,
          }),
        );
      }
    } else if ((m = sentence.match(/^(Carry|Review) (\d+):/))) {
      const alreadyBound =
        m[1] === "Carry" && text.includes(`Bind ${m[2]} to `);
      response.groups.push(
        alreadyBound
          ? { outcome: "NO_CHANGE", throughBoundary }
          : {
              outcome: "CARRY",
              throughBoundary,
              kind: "UNRESOLVED_REFERENCE",
              core: m[1] === "Review" ? (core ?? null) : null,
            },
      );
      last = record.index! + sentence.length;
      continue;
    } else if ((m = sentence.match(/^Bind (\d+) to (\d+)/))) {
      const target = samples.get(Number(m[2])),
        obligation = r.obligations.find((o) =>
          o.phrase.includes(`Carry ${m![1]}:`),
        );
      if (!target) return waitFor(`p${m[2]}`, "READ");
      if (obligation) {
        const source = r.context.find((c) => c.source === obligation.source)!;
        resolutions.push({
          obligation: obligation.id,
          targets: [target],
          basis: [whole(source), ...basis],
        });
      }
    } else if (
      (m = sentence.match(/^(Ask: compare|Compare) (\d+) with (\d+)/))
    ) {
      const targets = [samples.get(Number(m[2])), samples.get(Number(m[3]))];
      if (targets.some((t) => !t)) return waitFor(`p${m[2]} p${m[3]}`, "READ");
      if (m[1] === "Ask: compare")
        operations.push({
          type: "cue",
          value: {
            text: `Compare samples ${m[2]} and ${m[3]} at fixed temperature.`,
            targets: targets as string[],
          },
          basis,
        });
      else
        operations.push({
          type: "put",
          id: r.newUnits[slot++],
          coreId: core!,
          meaning: {
            kind: "relation",
            relation: "comparison",
            text: `Compare samples ${m[2]} and ${m[3]}.`,
            targets: targets as string[],
          },
          dependencies: [],
          basis,
        });
    } else if (!sentence.startsWith("Identify "))
      throw new Error("fixture-unrecognized-record");
    response.groups.push(
      operations.length || resolutions.length
        ? { outcome: "APPLY", throughBoundary, operations, resolutions }
        : { outcome: "NO_CHANGE", throughBoundary },
    );
    last = record.index! + sentence.length;
  }
  if (text.slice(last).trim()) response.suffixStatus = "WAIT_MORE_INPUT";
  else if (response.groups.length)
    response.groups.at(-1)!.throughBoundary = r.source.end;
  else if (!text.trim())
    response.groups = [{ outcome: "NO_CHANGE", throughBoundary: r.source.end }];
  else response.suffixStatus = "WAIT_MORE_INPUT";
  return response;
}
