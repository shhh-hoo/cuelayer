# Speech-first FX Engine motion grammar

Operations express teaching meaning; treatments express visual implementation.

| Cue | Purpose | Current treatments |
|---|---|---|
| `FOCUS` | Direct temporary attention to one minimal semantic phrase, variable, concept or formula term | marker, spotlight, scale, dim surrounding |
| `RELATE` | Make a stated cause, sequence, or contrast easier to track with phrase grouping, alignment and connectors | chain, ordered steps, split contrast |
| `TRANSFORM` | Show the same object, state or expression moving from A to B | replace, derive, state change |

Semantic phrases are atomic visual units: a continuous phrase is wrapped and treated as one object, not as independently highlighted words. Short phrases may stay together; longer phrases may wrap while their visual treatment remains continuous.

`CueTarget.displayText` is part of the representation grammar. FX may render conventional, semantically equivalent notation such as `↑`, `↓`, `=`, `≈`, `÷`, `→`, or `⇌`; Plain remains the canonical authored-caption surface.

For processual `RELATE` and `TRANSFORM` cues, targets progress through `pending`, `active`, and `completed`. Normally only one target is active; completed targets remain as lower-emphasis context until the settled hold ends and ordinary captions return. Cause and sequence accumulation are derived by the renderer from the relation and timed words, not authored as an `EffectCue` field. Contrast is normally simultaneous rather than a simulated process.

Layout and progression take priority over broad highlight backgrounds. FOCUS is sparse; RELATE and TRANSFORM prefer grouping, alignment, line breaks, connectors, symbolic notation, weight and restrained opacity.
