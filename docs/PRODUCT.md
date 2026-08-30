# CueLayer FX Engine v0

## Product question

Do restrained teaching-caption effects make a lesson easier to follow than plain captions without turning it into automatic notes or short-form-video typography?

## Input and output

Input: manually authored `captionText`, timed words, and manually authored effect cues. Output: continuous learner-visible captions with brief semantic motion at selected moments.

The FX engine does not know whether its caption came from ASR, a future composer, or a human author. It does not alter caption text.

## Boundaries

The FX Lab is an authoring/debugging surface. The eventual Continuous Showcase is a separate, control-free viewing experience. The active grammar is `FOCUS`, `RELATE`, and `TRANSFORM`; a clip with no cue is normal captions.

## Deferred

Caption composition, knowledge sources, provenance, effect planning, and realtime ASR are deferred until the visual engine has demonstrated value.
