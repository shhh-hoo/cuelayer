import type { FxExample } from "./motion-grammar";

export const fxExamples: FxExample[] = [
  {
    id: "focus-key-variable",
    operation: "FOCUS",
    title: "Focus a key variable",
    purpose: "Redirect attention briefly without rewriting the explanation.",
    teacherLine:
      "The key idea is that nuclear charge increases across the period.",
    plan: {
      operation: "FOCUS",
      targets: ["nuclear charge"],
      intensity: "normal",
      durationMs: 1400,
    },
  },
  {
    id: "build-causal-chain",
    operation: "BUILD",
    title: "Build a causal chain",
    purpose: "Expose the structure of an explanation as the teacher constructs it.",
    teacherLine:
      "Nuclear charge increases, attraction becomes stronger, so atomic radius decreases.",
    plan: {
      operation: "BUILD",
      targets: ["nuclear charge ↑", "attraction ↑", "atomic radius ↓"],
      relation: "cause",
      intensity: "normal",
      durationMs: 2800,
    },
  },
  {
    id: "compare-concepts",
    operation: "COMPARE",
    title: "Compare two concepts",
    purpose: "Keep both ideas visible long enough for the learner to inspect the relation.",
    teacherLine:
      "Rate tells us how fast the reaction is happening; the rate constant belongs to the rate equation.",
    plan: {
      operation: "COMPARE",
      targets: ["rate", "rate constant"],
      relation: "contrast",
      intensity: "subtle",
      durationMs: 2600,
    },
  },
  {
    id: "transform-equation",
    operation: "TRANSFORM",
    title: "Show a transformation",
    purpose: "Represent a change rather than merely describing that something changed.",
    teacherLine:
      "Now substitute y equals u squared, so dy by dx becomes two u times du by dx.",
    plan: {
      operation: "TRANSFORM",
      targets: ["y = u²", "dy/dx = 2u · du/dx"],
      relation: "transformation",
      intensity: "normal",
      durationMs: 2600,
    },
  },
  {
    id: "trace-graph",
    operation: "TRACE",
    title: "Trace a visual referent",
    purpose: "Bind spoken explanation to the exact part of a graph or diagram being discussed.",
    teacherLine:
      "Follow the curve up to the transition state, then down toward the products.",
    plan: {
      operation: "TRACE",
      targets: ["reaction pathway", "transition state", "products"],
      relation: "spatial",
      intensity: "normal",
      durationMs: 3000,
    },
  },
  {
    id: "hold-final-structure",
    operation: "HOLD",
    title: "Hold the completed structure",
    purpose: "Counter transient information after a dense explanation has finished unfolding.",
    teacherLine:
      "So the final relationship is pressure up, equilibrium shifts to the side with fewer gas molecules.",
    plan: {
      operation: "HOLD",
      targets: ["pressure ↑ → fewer gas molecules"],
      relation: "cause",
      intensity: "subtle",
      durationMs: 3200,
    },
  },
];
