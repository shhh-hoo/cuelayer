export type MotionOperation =
  | "FOCUS"
  | "BUILD"
  | "COMPARE"
  | "TRANSFORM"
  | "TRACE"
  | "HOLD";

export type EffectPlan = {
  operation: MotionOperation;
  targets: string[];
  relation?:
    | "cause"
    | "sequence"
    | "contrast"
    | "equivalence"
    | "transformation"
    | "spatial";
  intensity: "subtle" | "normal" | "strong";
  durationMs: number;
};

export type FxExample = {
  id: string;
  operation: MotionOperation;
  title: string;
  purpose: string;
  teacherLine: string;
  plan: EffectPlan;
};
