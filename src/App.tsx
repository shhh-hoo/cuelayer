import { MotionConfig } from "motion/react";
import { FxLab } from "./lab/FxLab";

export default function App() {
  return <MotionConfig reducedMotion="user"><FxLab /></MotionConfig>;
}
