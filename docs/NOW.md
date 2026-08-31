# CueLayer NOW

_Last updated: 2026-08-31_

## Current milestone

**First Usable Alpha**

The immediate goal is not a production-grade SaaS system. The goal is a web product that can be used for a real 20–30 minute teaching session without developer intervention.

The current vertical slice is:

```text
presentation window
      ↓
Presentation Proxy
      +
microphone
      ↓
streaming ASR
      ↓
canonical speech state
      ↓
AI runtime decision
      ↓
adaptive learner-visible representation
      ↓
fullscreen session
```

## Alpha user journey

1. Open CueLayer in a supported desktop Chromium browser.
2. Start a session.
3. Select a PowerPoint, Keynote, browser tab, or other presentation window through browser screen capture.
4. Select/allow the microphone.
5. Teach normally.
6. CueLayer continuously maintains the canonical speech state.
7. The learner-visible surface adaptively remains quiet, shows text, or renders bounded semantic FX.
8. CueLayer may show sparse `NOTE` or `REFLECT` learning cues when justified.
9. The teacher can pause/resume, toggle adaptive FX, enter fullscreen, and end the session.
10. AI enhancement failure does not break the presentation proxy or canonical speech pipeline.

## Must work in this milestone

### Presentation transport

- Browser `getDisplayMedia()` capture of a selected presentation window/tab/screen.
- Live presentation video used as the stage background.
- Fullscreen learner-visible output.
- Clean handling when capture ends or permission is denied.

### Live speech

- Microphone capture.
- Streaming ASR with interim and final updates.
- Continuous canonical transcript/speech state.
- Basic correction/revision handling sufficient for live use.
- Canonical state remains available even when the adaptive learner-visible surface is quiet.

### Adaptive representation

The runtime must support these display intents:

- `QUIET`
- `TEXT`
- `FOCUS`
- `RELATE`
- `TRANSFORM`

`QUIET` is not an error state. It is a valid product decision when showing additional material would not help.

The existing bounded renderer remains the execution layer for `FOCUS`, `RELATE`, and `TRANSFORM`.

### Learning cues

Alpha supports only:

- `NONE`
- `NOTE`
- `REFLECT`

`NOTE` may be triggered deterministically when a useful structure settles. `REFLECT` should require a grounded pedagogical handoff rather than an automatically invented question.

### AI/runtime boundary

- AI decides semantic/pedagogical intent, not arbitrary visual styling.
- Deterministic code validates and compiles model output into the existing bounded visual grammar.
- Stale AI results are discarded rather than rewinding the learner-visible surface.
- Model errors, invalid output, or latency never block presentation capture or canonical speech acquisition.

### Session controls

- Start.
- Pause/resume.
- End.
- Fullscreen.
- Adaptive FX on/off.
- Minimal visible error states.
- Basic local/debug session log sufficient to inspect ASR events, runtime decisions, fallbacks, and stale-result drops.

## Build order

### M0 — Presentation Proxy

**Done when:** a selected presentation window can be shown live in a CueLayer learner stage and placed fullscreen while the source presentation continues to be controlled normally.

### M1 — Live canonical speech

**Done when:** a teacher can speak continuously and CueLayer maintains a usable real-time canonical speech stream over the live presentation.

Temporary full/plain text rendering is acceptable here as a development baseline. It is not the final default product policy.

### M2 — Adaptive semantic loop

**Done when:** final/stable speech segments can produce `QUIET`, `TEXT`, `FOCUS`, `RELATE`, or `TRANSFORM`; valid semantic intents compile into the existing renderer; AI failure leaves the base experience intact.

### M3 — Learning cues

**Done when:** sparse `NOTE` and `REFLECT` moments can appear without turning every utterance into an intervention.

### M4 — Dogfood hardening

**Done when:** a real 20–30 minute teaching session can run without manual developer repair, including ordinary speech, pauses, self-correction, code-switching, domain notation, AI latency/failure, and presentation-capture termination.

## Explicitly not now

Do not expand the current milestone to include:

- user accounts or authentication;
- billing;
- cloud database architecture unless a blocker emerges;
- teacher/student dashboards;
- analytics infrastructure;
- multi-user collaboration;
- desktop packaging;
- native always-on-top overlay;
- Document Picture-in-Picture as a required path;
- PPT/Keynote parsing;
- slide-object recognition or coordinate grounding;
- molecule, graph, diagram, or mechanism visual grounding;
- generated lesson summaries;
- generated answers;
- autonomous generated reflection questions beyond the teacher's grounded pedagogical handoff;
- student profiles or adaptive tutoring;
- production knowledge-base infrastructure;
- production-scale reliability/observability infrastructure.

These are deferred, not necessarily rejected.

## Current product risks to watch

1. **Caption drift:** defaulting back to "show every spoken word" instead of treating canonical speech as internal grounding and rendering adaptively.
2. **FX drift:** using AI to generate visually impressive but semantically unbounded effects.
3. **Tutor drift:** turning `NOTE` / `REFLECT` into constant AI guidance or generated teaching content.
4. **Infrastructure drift:** building SaaS/backend systems before the live teaching loop works.
5. **Slide-understanding drift:** confusing presentation capture with visual grounding of slide objects.
6. **Latency coupling:** allowing LLM latency to block the base live experience.

## Exit condition

First Usable Alpha is complete when the product can be opened as a web app, capture a real presentation and microphone, maintain canonical speech, adaptively render a quiet/text/semantic learner surface with sparse learning cues, survive ordinary AI failure, and complete a 20–30 minute session without developer intervention.