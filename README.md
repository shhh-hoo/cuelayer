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

`captionText` is the canonical Plain surface. FX preserves its meaning, but a phrase target may use semantically equivalent `displayText` notation such as `↑`, `↓`, or `÷ 3`. Future systems can provide caption text and timed words, while an effect planner can provide cues, without changing the renderer.

## Architecture

- **Speech-first Caption Engine — current:** manually authored captions, timed words, phrase-level targets, symbolic notation, semantic layouts and progression.
- **Slide-linked Overlay Engine — deferred:** requires visual grounding before it can point to or trace slide objects, graphs, diagrams or existing animations.

## Current scope

- `NONE` (no cue), `FOCUS`, `RELATE`, and `TRANSFORM`
- Plain / FX comparison, timeline scrubbing, treatment and timing controls
- Reduced-motion preview
- Visual fixtures for testing effects, not production teaching content

## Deliberate non-goals

Caption composition, provenance enforcement, a knowledge base, AI planning, automatic summaries, notes, diagrams, teacher/student workflows, and realtime ASR.
