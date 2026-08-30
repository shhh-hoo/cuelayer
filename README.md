# CueLayer

**Caption-native, source-grounded pedagogical motion captions.**

CueLayer applies restrained, meaningful motion to exact spans in an existing teacher transcript. It reduces the mechanical effort of following a lesson without replacing the learner's work of selecting, organizing, integrating, and taking notes.

## Product thesis

- The foreground product is only **AI special-effect captions**.
- All substantive learner-visible text is traceable to exact transcript spans.
- Motion should represent teaching meaning, not decorate speech.
- Most classroom speech should remain visually quiet.
- Course and lesson knowledge provide grounding for later AI effect planning.
- The first development milestone is a **Teaching Caption FX Lab**, before realtime ASR or a full AI planner.

## Initial motion grammar

`NONE` · `FOCUS` · `RELATE` · `TRANSFORM`

`NONE` is the default. `HOLD` is a display policy (`holdMs` and `decay`), not an operation. `TRACE` is deferred until CueLayer can ground a caption to a reliable visual referent.

## Explicit non-goals for V0

AI notes, summaries, diagrams, equations, normalized teaching content, tutors, quizzes, student interaction flows, teacher dashboards, cueboards, post-class recap, LMS features, and realtime ASR.

## Architecture boundary

An eventual AI planner selects a semantic operation, exact transcript spans, a treatment preset, and timing policy. The deterministic renderer owns layout, CSS, Motion behavior, and accessibility. It never invents substantive teaching text.
