# CueLayer Product Charter

## Product definition

CueLayer is an AI-native presentation layer for teaching.

It listens to teaching as it unfolds, maintains a speech-faithful semantic source of truth, and adaptively decides what learners should see and when a learner-facing cue is useful. The product aims to reduce tracking and transcription effort while preserving the learner's work of understanding, organising, and reflecting.

The canonical speech representation is a grounding layer. Learner-visible output is adaptive rather than synonymous with a continuous transcript.

## Primary experience

The teacher teaches naturally. CueLayer interprets the live explanation and turns useful structure into a restrained learner-visible surface.

The learner experience is organised around two questions:

1. What should I notice right now?
2. What should I do right now?

The learner-visible surface can combine presentation content, selective text, semantic visual structure, and sparse learning cues.

## AI-native operating model

Natural teaching is the primary interface.

AI handles interpretation where meaning or pedagogical intent is uncertain: what the teacher is expressing, whether a visible intervention is useful, how current speech relates to recent teaching context, and whether the learner has reached a meaningful note-taking or reflection moment.

Deterministic software handles predictable execution: validation, bounded visual grammar, layout, animation treatment, timing policy, state transitions, fallback, and rendering.

The resulting system follows this division:

```text
teacher speech + teaching context
               ↓
      canonical speech state
               ↓
       AI interpretation
          ↙           ↘
 display intent    learner intent
          ↘           ↙
      deterministic runtime
               ↓
     learner-visible surface
```

## Adaptive representation

CueLayer treats representation as a policy decision rather than assuming every spoken word should remain visible.

The current display grammar is:

- `QUIET`: the best learner-visible state is visual quiet.
- `TEXT`: readable speech-derived text is the useful representation.
- `FOCUS`: direct attention to one minimal semantic anchor.
- `RELATE`: expose an explicitly grounded cause, sequence, or contrast.
- `TRANSFORM`: show the same object, expression, or state changing representation or state.

`QUIET` is a successful decision. A useful CueLayer session should contain substantial visually quiet time.

Every learner-visible representation remains grounded in the teacher's speech and approved context. Symbolic or spatial compression may make stated meaning easier to follow while preserving the teacher's asserted meaning, corrections, uncertainty, and deliberate wording.

## Learning cues

Content representation and learner-action timing are separate channels.

The initial learner-intent grammar is:

- `NONE`: the learner continues naturally without an additional cue.
- `NOTE`: a stable structure or exact formulation has reached a useful recording point.
- `REFLECT`: the teacher has created a genuine handoff of cognitive work to the learner.

Learning cues are intentionally sparse. Their role is to clarify timing of attention, note-taking, and reflection rather than supply the learner's reasoning.

A `NOTE` opportunity can often emerge from deterministic runtime state after a meaningful structure settles. A `REFLECT` cue is grounded in pedagogical evidence such as a teacher question, prediction request, comparison prompt, or deliberate invitation to think.

## Teaching State

CueLayer should increasingly understand explanations as evolving structures rather than isolated utterances.

Teaching State may accumulate semantic relationships, current topic, recently established concepts, unresolved references, and pedagogical phase across speech turns. This allows a causal chain, comparison, derivation, or other explanation to grow as the teacher develops it.

The architecture should preserve this direction while allowing useful bounded decisions from shorter context windows.

## Runtime principles

1. **Natural teaching is the control surface.** The teacher's normal explanation drives the system.
2. **Canonical speech is recoverable.** Raw and canonical speech state ground interpretation, correction handling, replay, debugging, and learner-visible representation.
3. **Adaptive representation is the default product model.** The system selects among quiet, text, semantic structure, and learning cues according to the teaching moment.
4. **Selective intervention is a feature.** `QUIET` and `NONE` are first-class outcomes.
5. **AI interprets; deterministic code executes.** Semantic and pedagogical intent compile into a bounded, testable visual runtime.
6. **Learner-visible meaning is grounded.** Visual compression preserves the teacher's actual assertions and context.
7. **Presentation transport remains independent from interpretation.** A presentation can provide the visual background while semantic slide understanding remains a separate capability.
8. **Probabilistic enhancement degrades gracefully.** Presentation transport and canonical speech remain usable while adaptive AI behaviour is delayed or unavailable.
9. **Usable vertical slices drive development.** Each implementation step should improve an end-to-end teaching experience that can be dogfooded.

## Product review test

A proposed feature or implementation is aligned when it strengthens one or more of these outcomes:

- the teacher can continue teaching naturally;
- the learner receives a clearer representation of the explanation;
- the learner receives a well-timed cue to note or reflect;
- AI is used where interpretation materially benefits from context and uncertainty;
- deterministic behaviour remains bounded and testable;
- the experience stays visually restrained;
- failure preserves the usable teaching flow;
- the implementation advances an end-to-end experience that can be tested in real teaching.
