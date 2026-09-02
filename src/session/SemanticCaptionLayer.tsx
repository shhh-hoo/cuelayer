import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { CaptionRenderer } from "../renderer/CaptionRenderer";
import type { CaptionEpisode, CaptionRuntimeState, TransientLearnerCue } from "../planner/contracts";
import type { CaptionClip } from "../types";
import type { CanonicalSpeechSpan, CanonicalSpeechState } from "./speech-types";
import type { PresentationMode } from "./presentation-mode";

function canonicalClipFor(span: CanonicalSpeechSpan): CaptionClip {
  return {
    id: `canonical-${span.id}-${span.revision}`,
    captionText: span.text,
    words: span.words.map((word, index) => ({ id: `${span.id}:word-${index}`, text: word.text, startMs: word.startMs, endMs: word.endMs })),
    cues: [],
  };
}

function episodeForCanonicalSpan(span: CanonicalSpeechSpan): CaptionEpisode {
  return { id: `canonical-${span.id}-${span.revision}`, clip: canonicalClipFor(span), status: "live", sourceSegmentIds: [span.id], activatedAt: span.updatedAtMs };
}

function EpisodeCaption({ episode, presentationMode, locked }: { episode: CaptionEpisode; presentationMode: PresentationMode; locked?: boolean }) {
  const reducedMotion = Boolean(useReducedMotion());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (locked) return;
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [locked]);
  const cueEnd = episode.cue ? episode.cue.startMs + episode.cue.durationMs + episode.cue.holdMs - 1 : 0;
  const currentMs = locked ? cueEnd : Math.min(cueEnd, Math.max(0, now - episode.activatedAt));
  return <div className={locked ? "semantic-caption semantic-caption-locked" : "semantic-caption"}>
    <CaptionRenderer clip={episode.clip} cue={episode.cue} currentMs={currentMs} mode="fx" reducedMotion={reducedMotion} embedded presentationMode={presentationMode} />
  </div>;
}

function LearnerCue({ cue, onExpire }: { cue: TransientLearnerCue; onExpire(cueId: string): void }) {
  useEffect(() => {
    const timeout = window.setTimeout(() => onExpire(cue.id), Math.max(0, cue.expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [cue, onExpire]);
  return <div className="learner-cue-layer" aria-live="polite"><span className="semantic-caption-cue">{cue.kind === "NOTE" ? "Note" : "Reflect"}</span></div>;
}

export function SemanticCaptionLayer({ runtime, speech, presentationMode, onRendered, onExpire, onLearnerCueExpire }: { runtime: CaptionRuntimeState; speech: CanonicalSpeechState; presentationMode: PresentationMode; onRendered?(episode: CaptionEpisode, now: number): void; onExpire(episodeId: string): void; onLearnerCueExpire(cueId: string): void }) {
  useEffect(() => {
    const expiresAt = runtime.current?.expiresAt;
    if (!runtime.current || !expiresAt) return;
    const timeout = window.setTimeout(() => onExpire(runtime.current!.id), Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [onExpire, runtime.current]);
  const latestSpan = speech.spans.at(-1);
  const currentMatchesCanonicalSpeech = Boolean(runtime.current && (!latestSpan || (
    runtime.current.sourceSegmentIds.includes(latestSpan.id)
    && runtime.current.activatedAt >= latestSpan.updatedAtMs
  )));
  const latestCanonicalEpisode = latestSpan?.text.trim() ? episodeForCanonicalSpan(latestSpan) : undefined;
  const primaryEpisode = presentationMode === "presentation-overlay"
    ? runtime.current
    : currentMatchesCanonicalSpeech
      ? runtime.current
      : latestCanonicalEpisode;
  const previousSurfaceKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!primaryEpisode) {
      previousSurfaceKey.current = undefined;
      return;
    }
    const surfaceKey = `${presentationMode}:${primaryEpisode.id}`;
    if (previousSurfaceKey.current === surfaceKey) return;
    previousSurfaceKey.current = surfaceKey;
    onRendered?.(primaryEpisode, Date.now());
  }, [onRendered, presentationMode, primaryEpisode]);
  return <>
    <div className={`adaptive-semantic-layer ${presentationMode}-semantic-layer`} aria-live="polite">
      {runtime.locked ? <EpisodeCaption episode={runtime.locked} presentationMode={presentationMode} locked /> : null}
      {primaryEpisode ? <EpisodeCaption episode={primaryEpisode} presentationMode={presentationMode} /> : null}
    </div>
    {runtime.learnerCue ? <LearnerCue cue={runtime.learnerCue} onExpire={onLearnerCueExpire} /> : null}
  </>;
}
