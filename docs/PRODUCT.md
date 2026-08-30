# CueLayer product contract — V0

## Operative claim
CueLayer turns teaching intent into restrained, meaningful motion in captions and on-screen text. It reduces the mechanical effort of following a lesson without replacing the learner's cognitive work.

## Foreground product
Only AI special-effect captions / pedagogical motion captions.

## Core pipeline
Teaching knowledge → pedagogical understanding → effect plan → deterministic motion renderer.

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
- AI tutor or chat
- quizzes or student interaction flows
- teacher dashboard / cueboard
- post-class recap
- LMS features
- realtime ASR in the first milestone

## Design constraints
- Most speech remains visually quiet.
- Motion must encode teaching meaning, not decorate speech.
- The model selects a constrained semantic operation; it does not generate CSS or arbitrary animation code.
- Effects must degrade cleanly to plain captions.
- Strong motion is scarce and should be governed by an effect budget.
- Reduced-motion accessibility must remain possible.

## V0 success question
Does a small, stable motion grammar make important teaching moments easier to see and follow than plain captions without becoming distracting short-form-video typography?
