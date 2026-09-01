import type { CaptionClip, CueTarget, EffectCue, TimedWord } from "../types";
import type { CaptionEpisode, GroundedSpeechTurn, GroundedTextReference, PlannerInput, RuntimeDecision } from "./contracts";

const EFFECT_DURATION_MS = 700;
const EPISODE_HOLD_MS = 5_000;

type CompiledSpeech = { clip: CaptionClip; wordsBySegment: Map<string, TimedWord[]> };

function compileSpeech(turns: GroundedSpeechTurn[], id: string): CompiledSpeech {
  const wordsBySegment = new Map<string, TimedWord[]>();
  const words = turns.flatMap((turn) => {
    const tagged = turn.words.map((word, index) => ({ id: `${turn.id}:word-${index}`, text: word.text, startMs: word.startMs, endMs: word.endMs }));
    wordsBySegment.set(turn.id, tagged);
    return tagged;
  });
  return { clip: { id, captionText: turns.map((turn) => turn.text).join(" "), words, cues: [] }, wordsBySegment };
}

function normalized(value: string) { return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }

function rewriteFor(reference: GroundedTextReference, decision: RuntimeDecision) {
  return decision.evidence?.rewrites
    ?.find((rewrite) => rewrite.source.segmentId === reference.segmentId && rewrite.source.text.normalize("NFC") === reference.text.normalize("NFC"));
}

function targetFor(reference: GroundedTextReference, wordsBySegment: Map<string, TimedWord[]>, index: number, displayText?: string): CueTarget | undefined {
  const sourceWords = wordsBySegment.get(reference.segmentId) ?? [];
  const expected = normalized(reference.text);
  if (!expected) return undefined;
  for (let start = 0; start < sourceWords.length; start += 1) {
    for (let end = start; end < sourceWords.length; end += 1) {
      const candidate = normalized(sourceWords.slice(start, end + 1).map((word) => word.text).join(" "));
      if (candidate === expected) return { id: `target-${index}`, wordIds: sourceWords.slice(start, end + 1).map((word) => word.id), displayText, keepTogether: true };
      if (candidate.length > expected.length && !candidate.startsWith(expected)) break;
    }
  }
  return undefined;
}

function targetsFor(references: GroundedTextReference[], wordsBySegment: Map<string, TimedWord[]>, decision: RuntimeDecision) {
  const targets = references.map((reference, index) => targetFor(reference, wordsBySegment, index, rewriteFor(reference, decision)?.displayText));
  return targets.every((target): target is CueTarget => Boolean(target)) ? targets : undefined;
}

function cueFor(decision: RuntimeDecision, wordsBySegment: Map<string, TimedWord[]>): EffectCue | undefined {
  const timing = { startMs: 0, durationMs: EFFECT_DURATION_MS, holdMs: EPISODE_HOLD_MS, intensity: "subtle" as const };
  if (decision.display.kind === "FOCUS") {
    const target = targetFor(decision.display.target, wordsBySegment, 0, rewriteFor(decision.display.target, decision)?.displayText);
    return target ? { ...timing, kind: "FOCUS", target, treatment: "marker" } : undefined;
  }
  if (decision.display.kind === "RELATE") {
    const targets = targetsFor(decision.display.targets, wordsBySegment, decision);
    if (!targets) return undefined;
    return { ...timing, kind: "RELATE", relation: decision.display.relation, targets, treatment: decision.display.relation === "cause" ? "chain" : decision.display.relation === "sequence" ? "ordered-steps" : "split-contrast" };
  }
  if (decision.display.kind === "TRANSFORM") {
    const [from, to] = targetsFor([decision.display.from, decision.display.to], wordsBySegment, decision) ?? [];
    return from && to ? { ...timing, kind: "TRANSFORM", from, to, treatment: "state-change" } : undefined;
  }
  return undefined;
}

function relevantTurns(input: PlannerInput, decision: RuntimeDecision) {
  const references = decision.display.kind === "FOCUS" ? [decision.display.target]
      : decision.display.kind === "RELATE" ? decision.display.targets
        : decision.display.kind === "TRANSFORM" ? [decision.display.from, decision.display.to] : [];
  const ids = new Set(references.map((reference) => reference.segmentId));
  return input.recentSpeech.filter((turn) => ids.size === 0 || ids.has(turn.id));
}

function compileTextEpisode(input: PlannerInput, decision: RuntimeDecision, id: string, now: number): CaptionEpisode | undefined {
  const display = decision.display;
  if (display.kind !== "TEXT") return undefined;
  const turn = input.recentSpeech.at(-1);
  if (!turn) return undefined;
  const compiled = compileSpeech([turn], id);
  return { id, clip: compiled.clip, status: "holding", sourceSegmentIds: [turn.id], activatedAt: now, expiresAt: now + EPISODE_HOLD_MS };
}

/** Compiles a bounded semantic intent into the renderer's existing CaptionClip / EffectCue grammar. */
export function compileCaptionEpisode(input: PlannerInput, decision: RuntimeDecision, id: string, now: number): CaptionEpisode | undefined {
  if (decision.display.kind === "QUIET") return undefined;
  if (decision.display.kind === "TEXT") return compileTextEpisode(input, decision, id, now);
  const turns = relevantTurns(input, decision);
  if (!turns.length) return undefined;
  const compiled = compileSpeech(turns, id);
  const cue = cueFor(decision, compiled.wordsBySegment);
  if ((decision.display.kind === "FOCUS" || decision.display.kind === "RELATE" || decision.display.kind === "TRANSFORM") && !cue) return undefined;
  if (cue) compiled.clip.cues = [cue];
  return { id, clip: compiled.clip, cue, status: "holding", sourceSegmentIds: turns.map((turn) => turn.id), activatedAt: now, expiresAt: now + EPISODE_HOLD_MS };
}
