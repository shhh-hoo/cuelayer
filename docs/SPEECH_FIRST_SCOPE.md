# CueLayer v0 Scope — Speech-first Caption Engine

## 1. Operative definition

CueLayer v0 is a speech-first pedagogical caption engine.

It turns a teacher's spoken explanation into a continuous caption experience: plain caption → semantically meaningful visual transformation → visible progression where content is processual → brief settled state → return to ordinary caption flow.

Most teaching remains plain and visually quiet. CueLayer uses phrase-level typesetting, symbolic notation, spatial arrangement and progression to make structure already expressed by the teacher easier to follow; it does not primarily highlight keywords.

## 2. Product split

### A. Speech-first Caption Engine — active V0 scope

Input: teacher speech (manually authored caption text in V0), timed words, phrase-level semantic targets, and manually authored effect cues.

Output: learner-visible captions, phrase-level motion, symbolic notation, process progression, and restrained semantic layout.

This layer does not require access to the teacher's PPT.

### B. Slide-linked Overlay Engine — deferred

Input: teacher speech; current slide, board, graph, diagram, existing slide equation requiring spatial grounding, molecule or spectrum; visual-object locations; and current slide state.

Output: pointing, tracing, graph or diagram overlays, spatial highlighting, and animation tied to an existing visual referent.

This layer is deferred until CueLayer has visual grounding for slide objects. The two layers must not be mixed during V0 development.

## 3. Current V0 contract

```ts
type CaptionClip = {
  id: string;
  captionText: string;
  words: TimedWord[];
  cues: EffectCue[];
};
```

`captionText` is the canonical plain-caption surface. Plain mode always displays `captionText`.

`CueTarget.wordIds` MUST be non-empty, ordered, contiguous within one `CaptionClip`, and refer only to existing `TimedWord` ids.

FX mode may use a phrase target's `displayText` to show shorter, semantically equivalent notation: `increases` → `↑`; `decreases` → `↓`; `approximately constant` → `≈ constant`; `equals` → `=`; and `divided by three` → `÷ 3`.

FX may compress an expression into standard notation, but it must not add a new explanation, conclusion or causal relationship.

## 4. Semantic unit

The minimum visual unit is a meaningful phrase, not an individual word.

Examples: `nuclear charge ↑`, `successful collisions ↑`, `atomic radius ↓`, `light blue precipitate`, `insoluble in excess`, and `rate = k[A]²[B]`.

A phrase is one visual object. Its treatment must not restart around every word in a continuous phrase. Short phrases should remain together where space allows. On smaller screens, a phrase may wrap, but its treatment must remain visually continuous.

## 5. Active semantic grammar

### FOCUS

Temporarily direct attention to one minimal semantic anchor: one variable, concept, formula term, or short phrase, normally one to three content words. FOCUS is sparse. It must not colour or highlight entire explanatory clauses. It is a modifier, not the main representation mechanism.

### RELATE

Make a relationship already stated by the teacher easier to follow. Supported relations are `cause`, `sequence`, and `contrast`. RELATE primarily uses grouping, alignment, connectors, line breaks, symbolic notation and progression rather than broad highlight backgrounds.

Cause example: `temperature ↑ → kinetic energy ↑ → successful collisions ↑ → reaction rate ↑`.

Sequence example: `1 calculate moles`, `2 use coefficient ratio`, `3 calculate required quantity`.

Contrast example: `defining clause / non-defining clause`, `essential information / extra information`, `no commas / commas`.

### TRANSFORM

Show the same object, expression or state changing from A to B.

Current valid examples: `reactants → products`, `solid iodine → liquid iodine`, and monomer → repeat unit. A spoken expression → canonical formula or initial equation → derived equation needs the next renderer capability: a same-span representation transform, where one semantic target changes from prose representation to symbolic representation. The current `from` / `to` contract does not yet support that same-span handoff.

An event causing a separate outcome is not automatically TRANSFORM. `stomata close → water loss decreases` is a causal RELATE operation, not a state transformation.

## 6. Progression

Processual content must show progress; do not render it only as a completed static structure.

Each target in a processual `RELATE` or `TRANSFORM` cue is `pending`, `active`, or `completed`.

- **Pending:** not yet introduced; hidden or visually subordinate.
- **Active:** currently explained; the primary visual focus. Normally only one target is active.
- **Completed:** already introduced; remains visible as stable, lower-emphasis context.

After the final target completes, the structure may settle briefly before returning to ordinary captions. Progress is embedded in the content itself; a generic progress bar is not the main representation.

## 7. Chemistry Speech FX Pack v0

The first domain pack is Chemistry. The goal is to prove that a small reusable grammar serves multiple Chemistry teaching situations, not to animate a complete 0620 or 9701 syllabus.

### 7.1 Causal build

Semantic implementation: `RELATE`, `relation = cause`. Progression behavior: **accumulate** (derived by the renderer from relation and timed words; not an `EffectCue` field).

Collision theory: `temperature ↑ → kinetic energy ↑ → fraction with E ≥ Eₐ ↑ → successful collisions ↑ → rate ↑`.

Reuse: Period 3 trends, Group 1 reactivity, equilibrium changes and intermolecular-force explanations.

### 7.2 Step progress

Semantic implementation: `RELATE`, `relation = sequence`. Progression behavior: **accumulate** (derived by the renderer from relation and timed words; not an `EffectCue` field).

Stoichiometry: `mass → n = m / Mᵣ → coefficient ratio → required quantity`.

Reuse: organic synthesis route, Paper 5 planning, titration calculations and qualitative-analysis procedure.

### 7.3 Evidence chain

Semantic implementation: `RELATE`, `relation = sequence or cause`.

Primary example: `reagent → observation → inference`. The inference must not appear before the observation.

Light semantic framing labels `REAGENT`, `OBSERVATION`, and `INFERENCE` are allowed, but must not turn the caption into an automatically generated answer card.

### 7.4 Formula assembly

Semantic implementation: `TRANSFORM`, with `derive` or canonical notation.

Examples: `ΔG = ΔH − TΔS`, `rate = k[A]²[B]`, and `E°cell = E°cathode − E°anode`.

The teacher must already have stated the variables and relationship. CueLayer may assemble standard notation but may not invent missing scientific reasoning.

### 7.5 State or representation transformation

Semantic implementation: `TRANSFORM`.

Examples: `CH₂=CH₂ → [–CH₂–CH₂–]ₙ`, `reactants → products`, and `solid → liquid`.

The change represents the same object or expression moving between states.

### 7.6 Split comparison

Semantic implementation: `RELATE`, `relation = contrast`.

Examples: oxidation versus reduction, endothermic versus exothermic, strong acid versus weak acid, electrophile versus nucleophile, and two standard electrode potentials. Current V0 supports an aligned two-sided comparison, not a multi-dimension comparison table; paired dimension rows remain a later grammar extension.

## 8. Caption-native acceptance boundary

A Chemistry design belongs in Speech-first V0 when it can be generated from spoken phrases and standard notation; requires no slide coordinates; uses text, simple connectors and CSS/Motion; has a small number of semantic units; fits a caption-oriented area; returns naturally to normal caption flow; and does not require a complete diagram or simulation.

Speech-first examples: causal chains, procedural sequences, comparisons, symbolic trends, formula assembly, state handoffs, and reagent–observation–inference chains.

A design belongs in the deferred Slide-linked Overlay layer when it requires locating a point or path on a graph, identifying atoms or bonds on a displayed molecule, tracing a titration or Boltzmann curve, identifying NMR peaks, pointing to a chromatography spot, following a mechanism arrow, or synchronising with an existing PPT animation.

The Speech-first engine must not redraw those visuals merely to claim it supports them.

## 9. Visual rules

### Phrase before word

Group meaning first. Animate words only when the word itself is the meaningful object.

### Layout before highlight

Prefer grouping, alignment, spacing, line break, connector, symbol and progression before background colour, glow, large scale or broad highlighting.

### Symbol before repeated prose

Use standard scientific and mathematical notation when it reduces mechanical reading effort without changing meaning.

### Progress before final card

For a process, show how the structure forms. Do not jump directly to a polished final summary.

### Sparse emphasis

Only one strong visual anchor should normally dominate at a time.

### Quiet majority

At least approximately 70% of a continuous lesson demonstration should remain ordinary captions.

### Reversibility

Every effect returns cleanly to ordinary captions.

## 10. Explicit V0 exclusions

Do not build during Speech-first V0: PPT parsing; slide-object recognition; graph or molecule coordinate grounding; diagram generation; full Chemistry simulations; complete micro-board authoring; real Caption Composer; production Knowledge Base; AI Effect Planner; realtime ASR; teacher dashboard; student note system; automatic lesson summary; or automated answers.

These are not rejected product directions; they are outside the current validation scope.

## 11. Next validation deliverables

### A. FX Lab

The FX Lab compares Plain and FX, tunes phrase grouping, inspects symbolic notation and progression, compares treatments, and identifies effects to keep, revise or delete.

### B. Chemistry Speech Showcase

The next target is a continuous 45–60 second simulated Chemistry explanation with no authoring controls, debug metadata, PPT or audio requirement. It keeps at least 70% ordinary-caption time and includes at least one causal build, step progression, comparison or evidence chain, symbolic formula or state transformation, visible intermediate progress states, and a clean return to ordinary captions.

The current branch contains a 40-second cross-topic Showcase with a mathematical sequence; it is the prototype, not yet this Chemistry validation deliverable.

## 12. Product review method

Do not create a large scoring system. Review each candidate treatment as `KEEP`, `REVISE`, or `DELETE`.

Ask:

1. Is the teaching meaning visible without reading debug metadata?
2. Does it reduce tracking or transcription effort compared with Plain?
3. Does it remain recognisably a caption experience?
4. Would it remain tolerable across a full lesson?
5. Does it preserve the learner's responsibility to understand and organise the content?

## 13. Exit condition for Speech-first Phase 1

Speech-first Phase 1 is complete when semantic phrases are never visually fragmented; conventional Chemistry relations use symbols where useful; processual content visibly progresses; highlighting is sparse; the selected grammar works across multiple Chemistry topics; the continuous Showcase communicates CueLayer's value without an explanatory interface; and the experience does not require a PPT.

Only after this point should development move upstream to grounded caption composition, course knowledge context, AI effect planning and realtime speech transcription. Slide-linked overlays remain a separate later phase.
