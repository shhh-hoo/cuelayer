import type { CanonicalSpeechSpan, CanonicalSpeechSpanCloseReason, CanonicalSpeechState, ProviderFinal, SpeechEvent, SpeechWord } from "./speech-types";

export const SPEECH_SPAN_ASSEMBLY = {
  maxGapMs: 900,
  idleCloseMs: 900,
  maxDurationMs: 6_500,
  maxWords: 28,
  plannerCheckpointMs: 2_500,
} as const;

/** One live semantic budget: planner work must not outlive the checkpoint cadence it serves. */
export const LIVE_PLANNER_BUDGET_MS = SPEECH_SPAN_ASSEMBLY.plannerCheckpointMs;

export type SpeechAssemblyChange = {
  decision: "opened" | "appended" | "closed";
  spanId: string;
  spanRevision: number;
  finalId?: string;
  closeReason?: CanonicalSpeechSpanCloseReason;
};

export type CanonicalSpeechUpdate = { state: CanonicalSpeechState; changes: SpeechAssemblyChange[] };

export type PlannerCheckpointCursor = {
  durationCheckpoint: number;
  sourceFinalCount: number;
};

export type DuePlannerCheckpoint = {
  spanId: string;
  spanRevision: number;
  cursor: PlannerCheckpointCursor;
};

export function createInitialCanonicalSpeechState(): CanonicalSpeechState {
  return { finals: [], spans: [] };
}

function provisionalFrom(event: Extract<SpeechEvent, { kind: "provisional" }>, index: number) {
  return { id: `provisional-${index}`, text: event.text, words: event.words };
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;
const CJK_START = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CLOSING_PUNCTUATION = /^[,.;:!?…，。！？、；：'’"”)}\]）】》」』]/u;
const OPENING_PUNCTUATION = /[('‘“[{（【《「『]$/u;
const TERMINAL_PUNCTUATION = /[.!?。！？…][\s'’"”)}\]）】》」』]*$/u;

export function joinTranscript(left: string, right: string) {
  const before = left.trimEnd();
  const after = right.trimStart();
  if (!before) return after;
  if (!after) return before;
  const separator = (CJK.test(before) && CJK_START.test(after)) || CLOSING_PUNCTUATION.test(after) || OPENING_PUNCTUATION.test(before) ? "" : " ";
  return `${before}${separator}${after}`;
}

function finalBounds(words: SpeechWord[], now: number) {
  return { startMs: words[0]?.startMs ?? now, endMs: words.at(-1)?.endMs ?? now };
}

function wordCount(text: string, words: SpeechWord[]) {
  return Math.max(words.length, (text.match(/[\p{L}\p{N}]+/gu) ?? []).length);
}

function closeSpan(span: CanonicalSpeechSpan, reason: CanonicalSpeechSpanCloseReason, now: number): CanonicalSpeechSpan {
  return { ...span, revision: span.revision + 1, status: "closed", closeReason: reason, updatedAtMs: now };
}

function openedSpan(final: ProviderFinal, index: number): CanonicalSpeechSpan {
  const bounds = finalBounds(final.words, final.committedAtMs);
  return {
    id: `speech-span-${index}`,
    revision: 1,
    sourceFinalIds: [final.id],
    text: final.text,
    words: final.words,
    startMs: bounds.startMs,
    endMs: bounds.endMs,
    openedAtMs: final.committedAtMs,
    updatedAtMs: final.committedAtMs,
    status: "open",
  };
}

function appendFinal(span: CanonicalSpeechSpan, final: ProviderFinal): CanonicalSpeechSpan {
  const bounds = finalBounds(final.words, final.committedAtMs);
  return {
    ...span,
    revision: span.revision + 1,
    sourceFinalIds: [...span.sourceFinalIds, final.id],
    text: joinTranscript(span.text, final.text),
    words: [...span.words, ...final.words],
    endMs: Math.max(span.endMs, bounds.endMs),
    updatedAtMs: final.committedAtMs,
  };
}

function closesForTerminalPunctuation(text: string) {
  return TERMINAL_PUNCTUATION.test(text.trim());
}

/** Provider finals remain immutable provenance; deterministic spans own product segmentation. */
export function applySpeechEvent(state: CanonicalSpeechState, event: SpeechEvent, now = 0): CanonicalSpeechUpdate {
  if (event.kind === "error") return { state, changes: [] };
  if (event.kind === "provisional") return { state: { ...state, provisional: provisionalFrom(event, state.finals.length) }, changes: [] };

  const final: ProviderFinal = {
    id: `provider-final-${state.finals.length}`,
    ...(event.speechEventId ? { speechEventId: event.speechEventId } : {}),
    text: event.text,
    words: event.words,
    committedAtMs: now,
  };
  const finals = [...state.finals, final];
  const spans = [...state.spans];
  const changes: SpeechAssemblyChange[] = [];
  let open = spans.at(-1)?.status === "open" ? spans.at(-1) : undefined;

  if (open) {
    const bounds = finalBounds(final.words, now);
    const gapMs = Math.max(0, bounds.startMs - open.endMs);
    const appendedText = joinTranscript(open.text, final.text);
    const appendedWords = [...open.words, ...final.words];
    const durationMs = Math.max(open.endMs, bounds.endMs) - open.startMs;
    const closeReason: CanonicalSpeechSpanCloseReason | undefined = gapMs > SPEECH_SPAN_ASSEMBLY.maxGapMs
      ? "timing_gap"
      : durationMs > SPEECH_SPAN_ASSEMBLY.maxDurationMs
        ? "max_duration"
        : wordCount(appendedText, appendedWords) > SPEECH_SPAN_ASSEMBLY.maxWords
          ? "max_words"
          : undefined;
    if (closeReason) {
      open = closeSpan(open, closeReason, now);
      spans[spans.length - 1] = open;
      changes.push({ decision: "closed", spanId: open.id, spanRevision: open.revision, closeReason });
      open = undefined;
    }
  }

  let current: CanonicalSpeechSpan;
  if (!open) {
    current = openedSpan(final, spans.length);
    spans.push(current);
    changes.push({ decision: "opened", spanId: current.id, spanRevision: current.revision, finalId: final.id });
  } else {
    current = appendFinal(open, final);
    spans[spans.length - 1] = current;
    changes.push({ decision: "appended", spanId: current.id, spanRevision: current.revision, finalId: final.id });
  }

  if (closesForTerminalPunctuation(final.text)) {
    current = { ...current, status: "closed", closeReason: "terminal_punctuation" };
    spans[spans.length - 1] = current;
    changes.push({ decision: "closed", spanId: current.id, spanRevision: current.revision, finalId: final.id, closeReason: "terminal_punctuation" });
  }

  return { state: { finals, spans, provisional: undefined }, changes };
}

export function closeCanonicalSpeechSpan(state: CanonicalSpeechState, spanId: string, revision: number, reason: CanonicalSpeechSpanCloseReason, now: number): CanonicalSpeechUpdate {
  const index = state.spans.findIndex((span) => span.id === spanId);
  const span = state.spans[index];
  if (!span || span.status !== "open" || span.revision !== revision) return { state, changes: [] };
  const closed = closeSpan(span, reason, now);
  const spans = [...state.spans];
  spans[index] = closed;
  return { state: { ...state, spans }, changes: [{ decision: "closed", spanId, spanRevision: closed.revision, closeReason: reason }] };
}

export function closeOpenCanonicalSpeechSpans(state: CanonicalSpeechState, reason: CanonicalSpeechSpanCloseReason, now: number) {
  return state.spans.reduce((next, span) => span.status === "open"
    ? closeCanonicalSpeechSpan(next, span.id, span.revision, reason, now).state
    : next, state);
}

export function isPlannerCheckpoint(span: CanonicalSpeechSpan) {
  return span.status === "closed" || span.endMs - span.startMs >= SPEECH_SPAN_ASSEMBLY.plannerCheckpointMs;
}

/** Open spans become eligible once per elapsed checkpoint; closure only adds work for newer speech. */
export function duePlannerCheckpoint(span: CanonicalSpeechSpan, previous?: PlannerCheckpointCursor): DuePlannerCheckpoint | undefined {
  const prior = previous ?? { durationCheckpoint: 0, sourceFinalCount: 0 };
  const durationCheckpoint = Math.floor(Math.max(0, span.endMs - span.startMs) / SPEECH_SPAN_ASSEMBLY.plannerCheckpointMs);
  const sourceFinalCount = span.sourceFinalIds.length;
  if (sourceFinalCount <= prior.sourceFinalCount) return undefined;
  if (span.status === "open" && durationCheckpoint <= prior.durationCheckpoint) return undefined;
  if (span.status === "open" && durationCheckpoint === 0) return undefined;
  return {
    spanId: span.id,
    spanRevision: span.revision,
    cursor: { durationCheckpoint: Math.max(prior.durationCheckpoint, durationCheckpoint), sourceFinalCount },
  };
}
