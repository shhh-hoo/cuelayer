import { MotionConfig } from "motion/react";
import { FxLab } from "./lab/FxLab";
import { SessionPage } from "./session/SessionPage";
import { Showcase } from "./showcase/Showcase";

export default function App() {
  const isSession = window.location.hash === "#/session" || window.location.pathname.endsWith("/session");
  const isShowcase = window.location.hash === "#/showcase" || new URLSearchParams(window.location.search).get("view") === "showcase" || window.location.pathname.endsWith("/showcase");
  if (isSession) return <MotionConfig reducedMotion="user"><SessionPage /></MotionConfig>;
  if (isShowcase) return <Showcase />;
  return <MotionConfig reducedMotion="user"><FxLab /></MotionConfig>;
}
