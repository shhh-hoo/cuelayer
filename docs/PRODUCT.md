# CueLayer v0 — Speech-first Caption Engine

## Product question

Do restrained, phrase-level caption transformations make a lesson easier to follow than plain captions without turning it into automatic notes or short-form-video typography?

## Input and output

Input: manually authored `captionText`, timed words, phrase-level `CueTarget` objects, and manually authored effect cues. Output: continuous learner-visible captions with brief semantic motion, symbolic notation and progression at selected moments.

`captionText` remains the canonical Plain surface. Plain mode renders it exactly. FX preserves that meaning but may use a `CueTarget.displayText` as a shorter, semantically equivalent representation—for example, `increases` as `↑` or `divided by three` as `÷ 3`. FX does not add a new explanation, conclusion or causal relationship.

## Boundaries

The active product is the Speech-first Caption Engine: it uses phrase-level semantic typesetting, symbolic notation, sparse emphasis and process progression without requiring access to a teacher's PPT. The FX Lab is an authoring/debugging surface; the Continuous Showcase is a separate, control-free viewing experience. The active grammar is `FOCUS`, `RELATE`, and `TRANSFORM`; a clip with no cue is normal captions.

The Slide-linked Overlay Engine is a separate, deferred product layer. It will require visual grounding for slide objects before it can point, trace, or coordinate overlays with graphs, diagrams, existing slide equations requiring spatial grounding, or existing slide animation. Reconstructing a standard formula from speech remains a Speech-first capability.

## Deferred

Caption Composer, Knowledge Base, provenance systems, AI effect planning and realtime ASR are deferred until the Speech-first engine has demonstrated value. Slide parsing, slide-object recognition, graph and molecule grounding, and diagram generation are also outside V0 scope.
