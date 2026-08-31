# CueLayer Product Charter

## 1. Product definition

CueLayer is an AI-native presentation layer for teaching.

It listens to teaching as it unfolds, maintains a speech-faithful semantic source of truth, and selectively decides what learners should see and when a learner-facing cue is useful. The product should reduce tracking and transcription effort without taking over the learner's work of understanding, organising, and reflecting.

CueLayer is not defined by continuous subtitles. The canonical speech representation is required internally; learner-visible rendering is adaptive.

## 2. Primary user and learner outcome

The primary operator is a teacher presenting live. The learner-visible surface may combine a presentation proxy, selective text, semantic visual structure, and sparse learning cues.

The product should help learners answer two implicit questions with less friction:

1. What should I notice right now?
2. What should I do right now?

The initial dogfood domain is Chemistry, but the product architecture must not depend on Chemistry-only visual logic.

## 3. AI-native thesis

Natural teaching is the primary interface. The teacher should not need to prompt an assistant, manually mark every important phrase, or select an animation type while teaching.

AI is responsible for uncertain interpretation: understanding the current teaching meaning, deciding whether a learner-visible intervention is useful, and identifying semantic or pedagogical intent.

Deterministic software is responsible for predictable execution: layout grammar, animation treatment, timing policy, state transitions, validation, fallback, and rendering.

Removing AI should remove CueLayer's autonomous interpretation and adaptive representation behaviour, not merely a decorative feature.

## 4. Core runtime loop

```text
teacher speech + recent teaching context
                    ↓
          canonical speech state
                    ↓
          AI interpretation layer
             ↙              ↘
      display intent      learner intent
             ↓              ↓
 QUIET / TEXT / FOCUS   NONE / NOTE /
 RELATE / TRANSFORM       REFLECT
             ↘              ↙
        deterministic runtime
                    ↓
          learner-visible surface
```

Future Teaching State may accumulate meaning across utterances, but current implementation must remain useful before that system is complete.

## 5. Product invariants

1. **Natural teaching is the primary control surface.** Product value must not depend on teachers continuously operating an AI interface while speaking.
2. **Canonical speech is always recoverable.** Raw ASR and canonical speech state ground learner-visible representations, debugging, replay, correction handling, and effect decisions.
3. **Canonical speech does not imply continuous visible subtitles.** Plain text is one representation and fallback, not the permanent product surface.
4. **Adaptive representation is the default direction.** Ordinary connective speech may remain visually quiet; exact wording, semantic structure, or learning-state changes may justify a visible representation.
5. **QUIET / NONE are first-class decisions.** Most teaching should remain visually restrained.
6. **AI interprets; deterministic code executes.** Models must not freely choose arbitrary colours, animation curves, durations, layouts, or unbounded visual treatments.
7. **Learner-visible semantics must be grounded.** CueLayer may compress or spatially represent meaning already supported by speech and approved context; it must not silently invent missing instructional or domain meaning.
8. **Teacher corrections, uncertainty, and deliberate wording are preserved.** A visually cleaner result must not erase what the teacher actually asserted.
9. **Learning cues are sparse.** NOTE and REFLECT should support timing of learner attention without becoming an always-on tutor or over-scaffolding layer.
10. **Probabilistic enhancement must degrade gracefully.** AI failure may remove adaptive representation, but it must not corrupt the presentation transport or canonical speech pipeline.
11. **Presentation Proxy is transport, not slide understanding.** Capturing a PowerPoint, Keynote, browser tab, or other presentation window does not imply slide parsing, object grounding, or automatic slide semantics.
12. **Prefer complete usable vertical slices over horizontal infrastructure.** New infrastructure is justified only when it directly supports a current user-facing requirement.

## 6. Bounded visual grammar

The current semantic grammar is intentionally small:

- `QUIET`: no learner-visible addition is warranted.
- `TEXT`: readable speech-derived text is the useful representation.
- `FOCUS`: direct attention to one minimal semantic anchor.
- `RELATE`: show an explicitly grounded cause, sequence, or contrast.
- `TRANSFORM`: show the same object, expression, or state changing representation or state.

The current learner-intent grammar is also intentionally small:

- `NONE`: no learner-state intervention.
- `NOTE`: a stable structure or exact formulation is worth recording.
- `REFLECT`: the teacher has created a genuine moment for learner thinking rather than immediate answer display.

New grammar should be added only when repeated real teaching cases cannot be represented cleanly by the existing vocabulary.

## 7. Architecture boundary

The desired dependency direction is:

```text
presentation transport ─────────────── works independently
speech / canonical state ──────────── works without AI enhancement
AI interpretation ────────────────── may fail without blocking the base experience
deterministic compiler / renderer ── bounded and testable
learner cues ──────────────────────── optional enhancement
```

Do not put LLM inference on the critical path for presentation capture or canonical speech acquisition.

## 8. Product review questions

For any proposed feature or implementation, ask:

1. Does this help the current teacher teach naturally rather than operate software?
2. Does it improve what the learner sees or when the learner should act?
3. Is AI necessary because interpretation is uncertain, or could deterministic logic do the job better?
4. Does the feature preserve a quiet majority rather than increasing visual noise?
5. Does failure degrade cleanly?
6. Is this required for the current usable vertical slice, or is it infrastructure/speculation that can wait?

If the answer to the final question is "it can wait," defer it.