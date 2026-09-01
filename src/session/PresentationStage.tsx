import { forwardRef, useEffect, useRef } from "react";
import type { ComponentProps, ReactNode } from "react";
import type { PresentationStatus, SessionStatus } from "./session-types";
import type { CanonicalSpeechState, SpeechStatus } from "./speech-types";
import type { CaptionEpisode, CaptionRuntimeState } from "../planner/contracts";
import { SemanticCaptionLayer } from "./SemanticCaptionLayer";
import { presentationModeFor, type PresentationMode } from "./presentation-mode";

type PresentationStageProps = {
  stream: MediaStream | null;
  presentationStatus: PresentationStatus;
  sessionStatus: SessionStatus;
  children?: ReactNode;
  speech: CanonicalSpeechState;
  speechStatus: SpeechStatus;
  showSpeechDebug: boolean;
  captionRuntime: CaptionRuntimeState;
  onCaptionRendered?(episode: CaptionEpisode, now: number, presentationMode: PresentationMode, observation: Parameters<NonNullable<ComponentProps<typeof SemanticCaptionLayer>["onRendered"]>>[2]): void;
  onCaptionExpire(episodeId: string, now: number, presentationMode: PresentationMode): void;
  onLearnerCueExpire(cueId: string): void;
};

const emptyStageCopy: Record<Exclude<PresentationStatus, "ready">, { title: string; detail: string }> = {
  empty: { title: "Ready for a live presentation", detail: "Choose the PowerPoint, Keynote, browser tab, or screen you want learners to see." },
  starting: { title: "Choosing a presentation", detail: "Use your browser’s picker to select the live source." },
  ended: { title: "Presentation connection ended", detail: "CueLayer is still running. Choose a presentation again when you are ready." },
  error: { title: "Presentation not connected", detail: "Choose a presentation again to continue." },
};

export const PresentationStage = forwardRef<HTMLElement, PresentationStageProps>(function PresentationStage({ stream, presentationStatus, sessionStatus, children, speech, speechStatus, showSpeechDebug, captionRuntime, onCaptionRendered, onCaptionExpire, onLearnerCueExpire }, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => undefined);
    return () => { video.srcObject = null; };
  }, [stream]);

  const presentationMode = presentationModeFor({ status: presentationStatus, stream });
  const teachingSurfaceActive = presentationMode === "presentationless" && (speechStatus !== "off" && speechStatus !== "ended" || speech.spans.length > 0 || Boolean(captionRuntime.current));
  const emptyCopy = presentationStatus === "ready" ? undefined : sessionStatus === "ended" ? { title: "Session ended", detail: "The presentation connection has been released. You can start another session whenever you are ready." } : teachingSurfaceActive ? undefined : emptyStageCopy[presentationStatus];
  return <section ref={ref} className={`presentation-stage presentation-${presentationStatus} presentation-mode-${presentationMode} session-${sessionStatus}`} data-presentation-mode={presentationMode} aria-label="Learner presentation stage">
    <div className="presentation-background">
      {stream ? <video ref={videoRef} className="presentation-video" autoPlay muted playsInline aria-label="Live shared presentation" /> : null}
    </div>
    <SemanticCaptionLayer runtime={captionRuntime} speech={speech} presentationMode={presentationMode} onRendered={(episode, now, observation) => onCaptionRendered?.(episode, now, presentationMode, observation)} onExpire={onCaptionExpire} onLearnerCueExpire={onLearnerCueExpire} />
    {showSpeechDebug && speechStatus !== "off" && speechStatus !== "ended" ? <aside className="speech-inspection-surface" aria-label="Live speech debug inspection">
      <span>Live speech · {speechStatus}</span>
      {speech.spans.slice(-3).map((span) => <p key={span.id}>{span.text}</p>)}
      {speech.provisional ? <p className="speech-provisional">{speech.provisional.text}</p> : null}
      {speechStatus === "error" ? <p className="speech-provisional">Speech is unavailable. The presentation is still live.</p> : null}
    </aside> : null}
    {emptyCopy ? <div className="presentation-empty-state" aria-live="polite"><p className="session-kicker">CueLayer live session</p><h1>{emptyCopy.title}</h1><p>{emptyCopy.detail}</p></div> : null}
    {sessionStatus === "paused" ? <p className="session-paused-label" aria-live="polite">CueLayer session paused</p> : null}
    {children ? <div className="presentation-control-layer">{children}</div> : null}
  </section>;
});
