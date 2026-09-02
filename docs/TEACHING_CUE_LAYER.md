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

- `ACTIVE`: the concept, relation, equation, reaction, or other teaching object currently being established or changed. It owns the strongest visual weight.
- `SUPPORT`: a condition, annotation, definition, or explanation attached to the active object. It should read as part of that object rather than generic body copy.
- `RETAINED`: previously established context that is still required for the current reasoning. It remains visible at deliberately lower weight and is not a scrolling transcript history.

This is a visual/runtime role model, not a new planner taxonomy. The fixture exercises definition, causal structure, equation, and chemical reaction content using the same three roles.

The intended board behaviour is working-memory-like rather than feed-like: useful structure can remain, new meaning can attach or reorganize it, and completed unrelated context can retreat. A topic label is shown only when the teaching content itself requires one; every board state does not receive an artificial heading.

## Layout contract

Board and Teaching Cue are semantic siblings, but they must not compete for the same pixels. `BoardLayout` first allocates a Board content region and a separate Teaching Cue region. It then measures the remaining Board region and deterministically selects one of three density tiers:

- `full`: `RETAINED + ACTIVE + SUPPORT`;
- `compact`: `ACTIVE + SUPPORT`; retained context has yielded;
- `essential`: `ACTIVE` only; support has yielded as well.

The current thresholds are intentionally simple Alpha policy, not pedagogy: under 360px of measured Board height retained context retreats, and under 240px support retreats. The important invariant is the yield order, not the exact threshold values.

Active content is not hidden behind `overflow: hidden`. If notation cannot remain legible in the width available to Active, the notation renderer falls back to wrapped plain text rather than silently cropping either side of an equation or reaction.

Presentationless mode reserves separate Board and Teaching Cue rows. Presentation-overlay mode gives the Board a bounded lower-left region and Teaching Cue a separate lower-right region; narrow layouts stack them.

The renderer should prefer normal Grid/Flex layout for content. Future spatial connectors may measure already-laid-out DOM boxes and draw SVG relationships; semantic objects themselves should not be positioned through unconstrained absolute coordinates.

## Notation contract

Equation and reaction content are notation objects, not hand-spaced prose and not free-form LaTeX supplied by a planner.

The Alpha contract is structured and bounded:

- equations contain a limited list of symbols, supported operators and at most bounded fractions;
- symbols may carry a small subscript or integer power;
- reactions contain bounded reactant/product species, optional integer coefficients, state symbols, and an enum arrow;
- formula strings reject braces and backslashes, so they cannot escape the deterministic `\\ce{...}` wrapper;
- the compiler produces the KaTeX/mhchem expression and the plain-text fallback;
- KaTeX renders with `throwOnError: true` and `trust: false`;
- a browser fit pass scales display notation only to a readability floor; below that floor it uses the wrapped plain-text fallback instead of clipping.

PR #9 intentionally loads pinned KaTeX/mhchem only inside the visual fixture so it does not create a package-lock conflict while PR #8 is changing deployment dependencies. Before live integration, package KaTeX with the application rather than depending on the external CDN.

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

`/teaching-cues` includes a `Stress layout` control. It deliberately expands retained context, support text, Teaching Cue text, equations and reactions so the same four scenes can be checked under pressure in both presentationless and presentation-overlay modes. The fixture exists to expose clipping and bad yield behaviour before live integration.

## Integration boundary

This slice deliberately does not change the live planner schema or session reducer while PR #8 is changing trace/session hot paths. `/teaching-cues` is the executable fixture for the contract and visual layer. After the Session Event Store work settles, Teaching Interpretation can feed this state through a small adapter and trace cue activation/replacement/resolution independently of board deltas.
