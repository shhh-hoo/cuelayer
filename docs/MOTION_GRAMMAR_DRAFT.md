# Pedagogical Motion Grammar — draft

These are representation operations, not animation styles. Each operation may have multiple visual treatments.

| Operation | Learning function | Typical teaching moment | Example treatments |
|---|---|---|---|
| `FOCUS` | Select relevant information | key variable, phrase, formula term | spotlight, marker sweep, subtle scale |
| `BUILD` | Externalize emerging structure | cause-effect chain, sequence, mechanism | progressive chain, staged reveal |
| `COMPARE` | Make relational structure visible | contrast, same/different, paired concepts | split layout, aligned attributes |
| `TRANSFORM` | Show change from one state to another | graph shift, equation derivation, state change | morph, move, replace |
| `TRACE` | Bind speech to a visual referent | diagram region, equation term, graph point | pointer, path trace, local highlight |
| `HOLD` | Counter transient information | completed formula, relation, diagram | settle and persist briefly |

## Rules

1. Motion must correspond to a semantic teaching function.
2. `NONE` is the default state; effects are exceptions.
3. One strong effect should dominate at a time.
4. If the source visual is already moving, prefer lower-motion cues to avoid redundant motion.
5. `TRACE` must point to a specific referent, not broadly illuminate an entire slide.
6. Completed `BUILD` / `COMPARE` / `TRANSFORM` structures may transition into `HOLD` to reduce transience.
7. The AI planner outputs operation + targets + relation + intensity. The renderer owns timing curves, CSS, layout and accessibility.

## Effect plan sketch

```ts
type MotionOperation = "NONE" | "FOCUS" | "BUILD" | "COMPARE" | "TRANSFORM" | "TRACE" | "HOLD";

type EffectPlan = {
  operation: MotionOperation;
  targets: string[];
  relation?: "cause" | "sequence" | "contrast" | "equivalence" | "transformation" | "spatial";
  intensity?: "subtle" | "normal" | "strong";
  durationMs?: number;
};
```

This schema will evolve only after the FX Lab reveals which distinctions are actually useful in rendering.
