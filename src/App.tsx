import { MotionConfig } from "motion/react";
import { FxLab } from "./lab/FxLab";
import { SessionPage } from "./session/SessionPage";
import { SpeechmaticsSessionProvider } from "./session/SpeechmaticsSessionProvider";
import { Showcase } from "./showcase/Showcase";
import { TeachingCueDemoPage } from "./teaching-cue/TeachingCueDemoPage";

export default function App() {
  const isSession = window.location.hash === "#/session" || window.location.pathname.endsWith("/session");
  const isShowcase = window.location.hash === "#/showcase" || new URLSearchParams(window.location.search).get("view") === "showcase" || window.location.pathname.endsWith("/showcase");
  const isTeachingCueDemo = window.location.hash === "#/teaching-cues" || new URLSearchParams(window.location.search).get("view") === "teaching-cues" || window.location.pathname.endsWith("/teaching-cues");
  if (isSession) return <MotionConfig reducedMotion="user"><SpeechmaticsSessionProvider><SessionPage /></SpeechmaticsSessionProvider></MotionConfig>;
  if (isShowcase) return <Showcase />;
  if (isTeachingCueDemo) return <MotionConfig reducedMotion="user"><TeachingCueDemoPage /></MotionConfig>;
  return <MotionConfig reducedMotion="user"><FxLab /></MotionConfig>;
}
