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

The Board answers **what teaching content has changed**. Teaching Cue answers **what unresolved classroom instruction the learner still needs to keep in view**.

## Board visual hierarchy

The Board does not use a default title/body/subtitle template. Visual hierarchy comes from semantic role:

- `ACTIVE`: the concept, relation, equation, reaction, or other teaching object currently being established or changed.
- `SUPPORT`: a condition, annotation, definition, or explanation attached to the active object.
- `RETAINED`: previously established context still required for current reasoning.

This is a visual/runtime role model, not a planner taxonomy. The Board behaves like working memory rather than a scrolling transcript: useful structure may remain; completed unrelated context retreats; a topic label appears only when the teaching content itself needs one.

## Deterministic layout contract

Board and Teaching Cue are semantic siblings but never compete for the same pixels. `BoardLayout` allocates a Board region and a separate Teaching Cue region using ordinary Grid/Flex layout.

Alpha avoids runtime geometry observers. Density is derived synchronously from stable content facts:

- `full`: `RETAINED + ACTIVE + SUPPORT`;
- `compact`: `ACTIVE + SUPPORT` when retained context should yield;
- `essential`: `ACTIVE` only for presentation overlays or unusually long learner cues.

Presentationless mode normally uses `full`; stress content can use `compact`; presentation-overlay is always `essential`. Active content is never hidden behind `overflow: hidden`.

## Structured notation contract

Equation and reaction content are bounded notation objects, not hand-spaced prose and not free-form LaTeX supplied by a planner.

The contract is:

```text
EquationSpec / ReactionSpec
          ↓
deterministic compiler
          ↓
packaged KaTeX + mhchem
          ↓
stable notation markup
```

The planner-facing data remains structured:

- equations contain bounded symbols, operators, powers, subscripts, and fractions;
- reactions contain bounded species, coefficients, states, and enum arrows;
- formula strings reject braces and backslashes;
- equation annotations address a piece index;
- reaction annotations address a side, species index, and bond index.

The compiler alone produces TeX/mhchem expressions. KaTeX is an npm dependency bundled by Vite. Rendering is synchronous during React render with `trust: false`, strict parsing, bounded expansion, and no planner-authored TeX.

There is no CDN fetch, runtime script injection, loading-to-ready DOM handoff, ResizeObserver, fit-state loop, or post-mount renderer replacement. CueLayer owns Board spatial layout; KaTeX/mhchem owns mathematical and chemical typography.

An annotation is compiled into the original target using notation structure. The Equation fixture attaches “second order in A” to the original `[A]²` term. The Reaction fixture attaches “the C=C bond is the changing part” to the actual double-bond token. Neither is implemented as a generic Board footer or duplicated target text.

Full skeletal structures, curved-arrow mechanisms, and stereochemical drawing remain outside this slice.

## Alpha Teaching Cue contract

One Teaching Cue may be active at a time:

- `QUESTION`: an unresolved teacher question.
- `TASK`: an instruction the learner is still carrying out.
- `NOTE`: a short reminder that the current material is worth recording.
- `HINT`: a hint the teacher has actually given. Alpha does not invent new problem-solving hints.

`QUESTION`, `TASK`, and `HINT` persist until explicit resolution or replacement. `NOTE` is transient by default. A Board update does not implicitly clear Teaching Cue, and resolving Teaching Cue does not remove Board content.

An instruction that contains a question remains one `TASK` cue. “Compare the two mechanisms. Which pathway is faster?” is one learner task, not two competing cues.

## Integration boundary

This slice does not change the live planner schema, SessionPage, Speechmatics, ASR, provider routing, or PR #8 trace. `/teaching-cues` remains the executable fixture for the domain/runtime/render contract. Live integration belongs in a later adapter PR after this surface is visually accepted.
