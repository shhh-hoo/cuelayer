# Teaching Cue Layer

Teaching Cue is an independent learner-facing channel. It does not sit inside the teaching board and it is not a renderer effect.

```text
speech evidence
      ↓
teaching interpretation
   ↙             ↘
board delta   teaching cue state
   ↘             ↙
      learner surface
```

The board answers **what teaching content has changed**. Teaching Cue answers **what unresolved classroom instruction the learner still needs to keep in view**.

## Board visual hierarchy

The board does not use a default title/body/subtitle template. Visual hierarchy comes from semantic role:

- `ACTIVE`: the concept, relation, equation, reaction, or other teaching object currently being established or changed.
- `SUPPORT`: a condition, annotation, definition, or explanation attached to the active object.
- `RETAINED`: previously established context still required for current reasoning.

This is a visual/runtime role model, not a planner taxonomy. The fixture exercises definition, causal structure, equation, and chemical reaction content using the same roles.

The board behaves like working memory rather than a scrolling transcript: useful structure may remain; completed unrelated context retreats; a topic label appears only when the teaching content itself needs one.

## Deterministic layout contract

Board and Teaching Cue are semantic siblings but never compete for the same pixels. `BoardLayout` allocates a Board region and a separate Teaching Cue region using ordinary Grid/Flex layout.

Alpha deliberately avoids runtime geometry observers. Density is derived synchronously from stable content facts:

- `full`: `RETAINED + ACTIVE + SUPPORT`;
- `compact`: `ACTIVE + SUPPORT` when retained context should yield;
- `essential`: `ACTIVE` only for presentation overlays or unusually long learner cues.

Presentationless mode normally uses `full`; stress content with several retained items uses `compact`; presentation-overlay is always `essential`. This keeps the yield order deterministic without resize/state feedback loops.

Active content is never hidden behind `overflow: hidden`. Presentationless mode reserves separate Board and Cue rows. Presentation-overlay gives the Board and Teaching Cue separate bounded regions; narrow layouts stack them.

Future spatial connectors may measure already-laid-out DOM boxes and draw SVG relationships, but the semantic objects themselves should not use unconstrained absolute positioning.

## Structured notation contract

Equation and reaction content are notation objects, not hand-spaced prose and not free-form LaTeX supplied by a planner.

The Alpha contract is structured and bounded:

- equations contain a limited list of symbols, supported operators and bounded fractions;
- symbols may carry a small subscript or integer power;
- reactions contain bounded reactant/product species, optional integer coefficients, state symbols, and an enum arrow;
- formula strings reject braces and backslashes;
- the deterministic compiler can still produce a TeX/mhchem expression for future renderers, but Alpha rendering does not depend on that expression.

The default Alpha renderer is synchronous native structured markup. It renders equation fractions, powers and subscripts directly, and renders reactions with real chemical subscripts, coefficients, state symbols and semantic wrapping boundaries. There is no runtime CDN fetch, KaTeX handoff, DOM replacement, ResizeObserver, or fit-state loop in the default surface.

KaTeX can be reconsidered later as a packaged optional enhancement after live integration. It is not required for correctness or legibility in this Alpha slice.

This notation boundary covers ordinary equations, chemical equations, charges/states and condensed formulae. Full skeletal structures, curved-arrow mechanisms, and stereochemical drawing remain outside this Alpha slice.

## Alpha Teaching Cue contract

One Teaching Cue may be active at a time:

- `QUESTION`: an unresolved teacher question.
- `TASK`: an instruction the learner is still carrying out.
- `NOTE`: a short reminder that the current material is worth recording.
- `HINT`: a hint the teacher has actually given. Alpha does not invent new problem-solving hints.

`QUESTION`, `TASK`, and `HINT` are persistent by default and leave through explicit resolution or replacement. `NOTE` is transient by default. A new active cue replaces the old one.

An instruction that contains a question remains one `TASK` cue rather than becoming two competing cues. For example, “Compare the two mechanisms. Which pathway is faster?” is one learner task with two sentences.

Teaching Cue has its own lifecycle. Board updates do not automatically clear it, and resolving a Teaching Cue does not remove teaching content from the board.

## Stress fixture

`/teaching-cues` includes a `Stress layout` control. It deliberately expands retained context, support text, Teaching Cue text, equations and reactions so the four scenes can be checked under pressure in presentationless and presentation-overlay modes.

## Integration boundary

This slice deliberately does not change the live planner schema or session reducer while PR #8 is changing trace/session hot paths. `/teaching-cues` is the executable fixture for the contract and visual layer. After the Session Event Store work settles, Teaching Interpretation can feed this state through a small adapter and trace cue activation/replacement/resolution independently of board deltas.
