import { MotionConfig } from "motion/react";
import { FxLab } from "./lab/FxLab";
import { Showcase } from "./showcase/Showcase";

export default function App() {
  const isShowcase = window.location.hash === "#/showcase" || new URLSearchParams(window.location.search).get("view") === "showcase" || window.location.pathname.endsWith("/showcase");
  if (isShowcase) return <Showcase />;
  return <MotionConfig reducedMotion="user"><FxLab /></MotionConfig>;
}
