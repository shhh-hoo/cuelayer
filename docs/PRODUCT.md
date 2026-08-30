# CueLayer product contract — V0

## Operative claim
CueLayer composes a source-traceable classroom caption, then applies restrained, meaningful motion to it. It reduces the mechanical effort of following a lesson without replacing the learner's cognitive work.

## Foreground product
Only AI special-effect captions / pedagogical motion captions.

## Core pipeline
Raw speech → raw transcript → Grounded Caption Composer → grounded caption → Effect Planner → deterministic motion renderer.

The Caption Composer and Effect Planner are separate layers. The composer may make bounded, high-confidence edits with provenance; the planner selects a constrained operation over grounded-caption spans. The renderer owns visual implementation and never generates teaching content.

Trusted sources are consulted in descending scope: current slide or board state, current lesson context pack, teacher-approved course material, then teacher-approved subject pack. General LLM knowledge is never a trusted source.

## V0 development order
1. Teaching Caption FX Lab
2. Pedagogical Motion Grammar
3. Teaching Knowledge Context
4. AI Effect Planner
5. Offline end-to-end demo
6. Evaluation
7. Realtime ASR

## Explicit non-goals
- AI notes or automatic summaries
- diagrams, unsolicited explanations, summaries, or silent factual correction
- AI tutor or chat
- quizzes or student interaction flows
- teacher dashboard / cueboard
- post-class recap
- LMS features
- realtime ASR in the first milestone

## Design constraints
- Most speech remains visually quiet.
- All substantive learner-visible text must be source-traceable, but need not be verbatim transcript text.
- The composer may repair spacing, punctuation and casing; remove whitelisted fillers, exact duplicate restarts, and clear false starts; apply glossary-backed term correction; resolve a referent from trusted lesson context; and use a source-backed canonical notation.
- It must not infer a new causal relation, generate an explanation, compress a longer explanation into a note, or use general model knowledge as a source of truth.
- If speech and a trusted source conflict, preserve the conflict for review rather than silently rewriting the teacher.
- Suppressed speech may be retained as a hidden pedagogical cue.
- Plain and FX render identical composed-caption content; only motion differs.
- `NONE` is the default operation; `FOCUS`, `RELATE`, and `TRANSFORM` are exceptions.
- `HOLD` is a display policy (`holdMs` and `decay`), not a semantic operation.
- `TRACE` is deferred until visual-referent grounding exists.
- Motion must encode teaching meaning, not decorate speech.
- The model selects a constrained semantic operation; it does not generate CSS or arbitrary animation code.
- Effects must degrade cleanly to plain captions.
- Strong motion is scarce and should be governed by an effect budget.
- Reduced-motion accessibility must remain possible.

## V0 success question
Does a small, stable motion grammar make important teaching moments easier to see and follow than plain captions without becoming distracting short-form-video typography?
