# CueLayer FX Engine v0

CueLayer FX Engine v0 renders restrained, pedagogically meaningful motion over manually authored captions. It is a visual experiment engine: given caption text, timed words, and effect cues, it lets us compare ordinary captions with the same captions enhanced by motion.

It is not currently a Caption Composer, knowledge base, AI planner, or realtime ASR system.

## Contract

```ts
type CaptionClip = {
  id: string;
  captionText: string;
  words: TimedWord[];
  cues: EffectCue[];
};
```

Plain and FX always render the identical `captionText`; FX changes presentation only. Future systems can provide caption text and timed words, while an effect planner can provide cues, without changing the renderer.

## Current scope

- `NONE` (no cue), `FOCUS`, `RELATE`, and `TRANSFORM`
- Plain / FX comparison, timeline scrubbing, treatment and timing controls
- Reduced-motion preview
- Visual fixtures for testing effects, not production teaching content

## Deliberate non-goals

Caption composition, provenance enforcement, a knowledge base, AI planning, automatic summaries, notes, diagrams, teacher/student workflows, and realtime ASR.
