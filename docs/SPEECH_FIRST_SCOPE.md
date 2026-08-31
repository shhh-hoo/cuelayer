# Speech-first Renderer Validation Scaffold

> Product authority: [PRODUCT_CHARTER.md](./PRODUCT_CHARTER.md). This document describes a phase-specific implementation and validation scaffold. Where its narrower assumptions differ from the Charter's adaptive product model, the Charter governs.

## Purpose

This scaffold validates whether a small, bounded visual grammar can represent teaching meaning clearly and quietly before the live planner/runtime is fully connected.

The current fixtures use authored `captionText`, timed words, semantic targets, and effect cues so renderer behaviour can be inspected deterministically. Continuous caption rendering in these fixtures is a comparison and validation surface, not the default CueLayer product model.

The product-level planner may later choose `QUIET`, `TEXT`, `FOCUS`, `RELATE`, or `TRANSFORM`. This renderer scaffold currently implements bounded effect cues for `FOCUS`, `RELATE`, and `TRANSFORM`; `QUIET` and `TEXT` resolve through ordinary renderer state rather than requiring new effect-cue kinds.

## Renderer contract

```ts
type CaptionClip = {
  id: string;
  captionText: string;
  words: TimedWord[];
  cues: EffectCue[];
};
```

Within this scaffold, `captionText` is the canonical authored comparison surface. `CueTarget.wordIds` are ordered, contiguous references to existing timed words.

FX rendering may use a target's semantically equivalent `displayText`, for example `increases` → `↑`, `decreases` → `↓`, `approximately constant` → `≈ constant`, or `divided by three` → `÷ 3`.

The renderer preserves grounded meaning while changing representation.

## Semantic unit

The minimum visual unit is a meaningful phrase rather than an arbitrary individual word.

Examples include `nuclear charge ↑`, `successful collisions ↑`, `atomic radius ↓`, `light blue precipitate`, `insoluble in excess`, and `rate = k[A]²[B]`.

A phrase behaves as one visual object. Short phrases remain together where space allows, and any wrapping preserves a visually continuous treatment.

## Bounded effect grammar

### FOCUS

Direct attention briefly to one minimal semantic anchor: a variable, concept, formula term, or short phrase. FOCUS is a modifier rather than the main representation mechanism.

### RELATE

Expose a relationship already grounded in the teaching context. Current relations are `cause`, `sequence`, and `contrast`.

Examples:

- Cause: `temperature ↑ → kinetic energy ↑ → successful collisions ↑ → reaction rate ↑`
- Sequence: `1 calculate moles → 2 use coefficient ratio → 3 calculate required quantity`
- Contrast: aligned paired concepts such as `essential information / extra information`

RELATE primarily uses grouping, alignment, connectors, line breaks, symbolic notation, and progression.

### TRANSFORM

Show the same object, expression, or state changing representation or state.

Examples include `reactants → products`, `solid iodine → liquid iodine`, and monomer → repeat unit.

A same-span representation handoff such as spoken prose → canonical formula is a useful extension of this semantic category even where the current `from` / `to` renderer contract still needs adaptation.

## Progression

Processual RELATE and TRANSFORM representations progress through content states:

- `pending`: not yet introduced;
- `active`: currently being explained;
- `completed`: already established and retained as context.

After the final target completes, the structure can settle briefly. The progression is embedded in the represented content rather than delegated to a generic progress indicator.

## Chemistry validation fixtures

Chemistry is the first domain used to stress the grammar across repeated teaching structures.

### Causal build

`RELATE / cause`

Example: `temperature ↑ → kinetic energy ↑ → fraction with E ≥ Eₐ ↑ → successful collisions ↑ → rate ↑`.

### Step progress

`RELATE / sequence`

Example: `mass → n = m / Mᵣ → coefficient ratio → required quantity`.

### Evidence chain

`RELATE / sequence` or `RELATE / cause`

Example: `reagent → observation → inference`, with progression preserving the order in which evidence becomes available.

### Formula assembly

`TRANSFORM`

Examples include `ΔG = ΔH − TΔS`, `rate = k[A]²[B]`, and `E°cell = E°cathode − E°anode` when the relationship is grounded in the teaching input.

### State or representation transformation

`TRANSFORM`

Examples include `CH₂=CH₂ → [–CH₂–CH₂–]ₙ`, `reactants → products`, and `solid → liquid`.

### Split comparison

`RELATE / contrast`

Examples include oxidation versus reduction, endothermic versus exothermic, strong acid versus weak acid, and electrophile versus nucleophile.

## Visual principles for this renderer

- **Phrase before word:** group meaning first.
- **Layout before highlight:** prefer grouping, alignment, spacing, connectors, and symbols before broad emphasis treatments.
- **Symbol before repeated prose:** use conventional notation when it reduces reading effort without changing meaning.
- **Progress before final structure:** show how processual meaning forms.
- **Sparse emphasis:** normally keep one strong visual anchor dominant at a time.
- **Visual restraint:** authored comparison fixtures should contain substantial ordinary/quiet time so effects can be judged against a calm baseline. Earlier 70% ordinary-caption tests are experimental scaffold criteria, not a product-level requirement for learner-visible captions.
- **Reversibility:** effect states settle cleanly back into the surrounding presentation flow.

## Presentation boundary

Presentation Proxy may provide a live PowerPoint, Keynote, browser tab, or other presentation surface as the stage background. This transport layer does not itself provide slide semantics.

Speech-grounded text, symbols, relations, and transformations can be rendered without slide-object coordinates. Pointing to graph locations, molecule atoms, diagram paths, existing slide equations, or other visual objects requires grounded visual context and belongs to a later slide-aware capability.

## Validation exit condition

This renderer scaffold has done its job when:

- semantic phrases remain visually coherent;
- conventional relations and notation are represented clearly;
- processual structures visibly progress;
- emphasis remains restrained across continuous examples;
- the same bounded grammar works across multiple teaching cases;
- authored or live upstream decisions can compile into the renderer without changing its semantic contract.

At that point, further product progress should come primarily from the live speech, Teaching State, planner, learner-cue, and presentation runtime defined by the Product Charter rather than from expanding the renderer grammar for its own sake.