# Pedagogical Motion Grammar — draft

These are representation operations, not animation styles. Each operation may have multiple visual treatments.

| Operation | Learning function | Typical teaching moment | Example treatments |
|---|---|---|---|
| `NONE` | Preserve normal caption reading | ordinary speech | plain caption |
| `FOCUS` | Select relevant information | key variable, phrase, formula term | spotlight, marker sweep, subtle scale |
| `RELATE` | Make an explicitly stated relationship legible | cause, sequence, contrast, equivalence, hierarchy | inline relation, progressive chain, aligned sequence |
| `TRANSFORM` | Show one spoken span developing into another spoken span | replacement, derivation, state change | replace, shift and reveal, derive inline |

## Rules

1. Motion must correspond to a semantic teaching function.
2. `NONE` is the default state; effects are exceptions.
3. One strong effect should dominate at a time.
4. If the source visual is already moving, prefer lower-motion cues to avoid redundant motion.
5. `RELATE` may reveal its source spans simultaneously or progressively. The previous `BUILD` treatment maps to progressive `RELATE`; the previous `COMPARE` maps to simultaneous contrast `RELATE`.
6. `HOLD` is a display policy: `holdMs` and `decay` apply after any operation.
7. `TRACE` is on the roadmap, not in the active V0 grammar, until visual-referent grounding exists.
8. The AI planner outputs an operation over source-traceable grounded-caption spans, relation, and display policy. The renderer owns timing curves, CSS, layout and accessibility.

## Effect plan sketch

```ts
type EffectPlan = {
  operation: CaptionOperation;
  display: {
    treatmentId: string;
    intensity: "subtle" | "normal" | "strong";
    startMs: number;
    durationMs: number;
    holdMs: number;
    decay: "restore-caption" | "fade" | "remain";
  };
};
```

This schema will evolve only after the FX Lab reveals which distinctions are actually useful in rendering.

## Composer boundary

Before planning motion, the Grounded Caption Composer can make bounded, provenance-bearing caption edits from raw speech and trusted lesson sources. It is not a summariser. Effect targets use `CaptionSpanRef` offsets within composed fragments, never raw-token ids alone.
