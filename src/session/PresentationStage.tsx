import { forwardRef, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { PresentationStatus, SessionStatus } from "./session-types";

type PresentationStageProps = {
  stream: MediaStream | null;
  presentationStatus: PresentationStatus;
  sessionStatus: SessionStatus;
  children?: ReactNode;
};

const emptyStageCopy: Record<Exclude<PresentationStatus, "ready">, { title: string; detail: string }> = {
  empty: { title: "Ready for a live presentation", detail: "Choose the PowerPoint, Keynote, browser tab, or screen you want learners to see." },
  starting: { title: "Choosing a presentation", detail: "Use your browser’s picker to select the live source." },
  ended: { title: "Presentation connection ended", detail: "CueLayer is still running. Choose a presentation again when you are ready." },
  error: { title: "Presentation not connected", detail: "Choose a presentation again to continue." },
};

export const PresentationStage = forwardRef<HTMLElement, PresentationStageProps>(function PresentationStage({ stream, presentationStatus, sessionStatus, children }, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => undefined);
    return () => { video.srcObject = null; };
  }, [stream]);

  const emptyCopy = presentationStatus === "ready" ? undefined : sessionStatus === "ended" ? { title: "Session ended", detail: "The presentation connection has been released. You can start another session whenever you are ready." } : emptyStageCopy[presentationStatus];
  return <section ref={ref} className={`presentation-stage presentation-${presentationStatus} session-${sessionStatus}`} aria-label="Learner presentation stage">
    <div className="presentation-background">
      {stream ? <video ref={videoRef} className="presentation-video" autoPlay muted playsInline aria-label="Live shared presentation" /> : null}
    </div>
    <div className="adaptive-semantic-layer" aria-hidden="true" />
    <div className="learner-cue-layer" aria-hidden="true" />
    {emptyCopy ? <div className="presentation-empty-state" aria-live="polite"><p className="session-kicker">CueLayer live session</p><h1>{emptyCopy.title}</h1><p>{emptyCopy.detail}</p></div> : null}
    {sessionStatus === "paused" ? <p className="session-paused-label" aria-live="polite">CueLayer session paused</p> : null}
    {children ? <div className="presentation-control-layer">{children}</div> : null}
  </section>;
});
