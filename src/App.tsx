import { MotionConfig } from "motion/react";
import { FxLab } from "./lab/FxLab";
import { Showcase } from "./showcase/Showcase";

export default function App() {
  if (window.location.pathname.endsWith("/showcase")) return <Showcase />;
  return <MotionConfig reducedMotion="user"><FxLab /></MotionConfig>;
}
