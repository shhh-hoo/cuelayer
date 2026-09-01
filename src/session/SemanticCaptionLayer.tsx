import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { CaptionRenderer } from "../renderer/CaptionRenderer";
import type { CaptionEpisode, CaptionRuntimeState, TransientLearnerCue } from "../planner/contracts";

function EpisodeCaption({ episode, locked }: { episode: CaptionEpisode; locked?: boolean }) {
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
    <CaptionRenderer clip={episode.clip} cue={episode.cue} currentMs={currentMs} mode="fx" reducedMotion={reducedMotion} embedded />
  </div>;
}

function LearnerCue({ cue, onExpire }: { cue: TransientLearnerCue; onExpire(cueId: string): void }) {
  useEffect(() => {
    const timeout = window.setTimeout(() => onExpire(cue.id), Math.max(0, cue.expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [cue, onExpire]);
  return <div className="learner-cue-layer" aria-live="polite"><span className="semantic-caption-cue">{cue.kind === "NOTE" ? "Note" : "Reflect"}</span></div>;
}

export function SemanticCaptionLayer({ runtime, onRendered, onExpire, onLearnerCueExpire }: { runtime: CaptionRuntimeState; onRendered?(episode: CaptionEpisode, now: number): void; onExpire(episodeId: string): void; onLearnerCueExpire(cueId: string): void }) {
  const renderedEpisodeIds = useRef(new Set<string>());
  useEffect(() => {
    const episode = runtime.current;
    if (!episode || renderedEpisodeIds.current.has(episode.id)) return;
    renderedEpisodeIds.current.add(episode.id);
    onRendered?.(episode, Date.now());
  }, [onRendered, runtime.current]);
  useEffect(() => {
    const expiresAt = runtime.current?.expiresAt;
    if (!runtime.current || !expiresAt) return;
    const timeout = window.setTimeout(() => onExpire(runtime.current!.id), Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [onExpire, runtime.current]);
  return <>
    <div className="adaptive-semantic-layer" aria-live="polite">
      {runtime.locked ? <EpisodeCaption episode={runtime.locked} locked /> : null}
      {runtime.current ? <EpisodeCaption episode={runtime.current} /> : null}
    </div>
    {runtime.learnerCue ? <LearnerCue cue={runtime.learnerCue} onExpire={onLearnerCueExpire} /> : null}
  </>;
}
