# CueLayer

**Source-traceable pedagogical motion captions.**

CueLayer composes a source-traceable classroom caption, then applies restrained, meaningful motion to it. It reduces the mechanical effort of following a lesson without replacing the learner's work of selecting, organizing, integrating, and taking notes.

## Product thesis

- The foreground product is only **AI special-effect captions**.
- All substantive learner-visible text is source-traceable, not necessarily verbatim transcript text.
- The composer may perform high-confidence cleanup, glossary correction, trusted referent completion, and source-backed notation canonicalisation.
- Motion should represent teaching meaning, not decorate speech.
- Most classroom speech should remain visually quiet.
- Course and lesson knowledge provide grounding for later AI effect planning.
- The first development milestone is a **Teaching Caption FX Lab**, before realtime ASR or a full AI planner.

## Initial motion grammar

`NONE` · `FOCUS` · `RELATE` · `TRANSFORM`

`NONE` is the default. `HOLD` is a display policy (`holdMs` and `decay`), not an operation. `TRACE` is deferred until CueLayer can ground a caption to a reliable visual referent.

## Explicit non-goals for V0

AI notes, summaries, diagrams, unsolicited explanations, silent factual correction, tutors, quizzes, student interaction flows, teacher dashboards, cueboards, post-class recap, LMS features, and realtime ASR.

## Architecture boundary

The pipeline is raw speech → raw transcript → Grounded Caption Composer → grounded caption → Effect Planner → Motion Renderer. Composition and motion planning are separate systems. The planner targets grounded-caption fragments; the renderer owns layout, CSS, Motion behavior, and accessibility. Neither may invent substantive teaching text.

Trusted context is limited to the current slide or board, lesson context pack, teacher-approved course material, and teacher-approved subject pack—in that order. General model knowledge is not a trusted source. Plain and FX views always use the same composed caption text.
