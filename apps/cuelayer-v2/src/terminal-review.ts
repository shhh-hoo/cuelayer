import type { Obligation, Replay, SourceRange } from "./contract";
import type { ReviewConcern } from "./stage";

/** Structural dispatch signals only. Stage/Live still owns every semantic decision. */
export function terminalRisk(text: string): string[] {
  const reasons: string[] = [];
  const trimmed = text.trim();
  if (/(?:\.{3,}|…)/.test(trimmed)) reasons.push("ELLIPSIS");
  const tail = trimmed.replace(/[\s.!?。！？…]+$/u, "");
  if (
    /(?:\b(?:and|or|but|because|if|when|while|which|that|to|of|with|from|times|plus|minus)|(?:因为|所以|如果|以及|并且|或者|但是))(?=\s*(?:[.!?。！？…\n]|$))/iu.test(
      trimmed,
    ) ||
    /[=+\-−×*/]$/u.test(tail)
  )
    reasons.push("TRAILING_CONNECTOR");
  if (
    /(?:\b(?:is|are|was|were|be|means|equals)|(?:是|为|等于))(?=\s*(?:[.!?。！？…\n]|$))/iu.test(
      trimmed,
    )
  )
    reasons.push("TRAILING_COPULA");
  const closes: Record<string, string> = {
    "(": ")",
    "[": "]",
    "{": "}",
    "（": "）",
    "【": "】",
    "「": "」",
    "“": "”",
  };
  const stack: string[] = [];
  for (const character of trimmed) {
    if (closes[character]) stack.push(closes[character]);
    else if (character === stack.at(-1)) stack.pop();
  }
  if (stack.length) reasons.push("UNCLOSED_DELIMITER");
  return reasons;
}

export type SourceSubject =
  | (Obligation & { range: SourceRange })
  | (ReviewConcern & { kind: "SOURCE_NO_CHANGE" });

export function getSourceSubject(
  replay: Replay,
  id: string,
): SourceSubject | undefined {
  const obligation = replay.unresolved[id];
  if (obligation?.range)
    return obligation as Obligation & { range: SourceRange };
  const concern = replay.reviewConcerns[id];
  return concern?.kind === "SOURCE_NO_CHANGE"
    ? (concern as ReviewConcern & { kind: "SOURCE_NO_CHANGE" })
    : undefined;
}
