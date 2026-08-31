# CueLayer Decisions

This file records product and architecture decisions that should not be repeatedly reopened without new evidence. It is intentionally concise. New decisions should state the decision, rationale, and what would justify revisiting it.

## 2026-08-31 — Web-first product

**Decision:** CueLayer will be implemented as a web product first.

**Rationale:** The current core experience can be delivered with browser microphone capture, screen/window capture, streaming ASR, server-side AI calls, and web rendering. A desktop shell would add packaging, signing, permissions, update, and cross-platform work before those capabilities are required.

**Revisit when:** a validated core workflow requires reliable transparent/click-through/system-wide always-on-top overlay behaviour that browser APIs cannot provide.

## 2026-08-31 — Presentation Proxy before native overlay

**Decision:** Use browser `getDisplayMedia()` to capture a teacher-controlled PowerPoint, Keynote, browser tab, or other presentation surface and render it as the background of the CueLayer learner stage.

**Rationale:** This produces a convincing learner-visible overlay without requiring CueLayer to own the presentation application or implement a native transparent window.

**Boundary:** Presentation Proxy is transport only. It does not provide slide parsing, object recognition, visual grounding, or semantic understanding of the captured slide.

**Revisit when:** real user workflows require direct native overlay rather than a proxied learner-visible output.

## 2026-08-31 — Canonical speech is required; continuous visible Plain Caption is not

**Decision:** CueLayer must maintain a recoverable raw/canonical speech representation, but it must not assume that the entire canonical caption is always visible to learners.

**Rationale:** Continuous full subtitles risk turning CueLayer into a conventional caption product, increasing visual load and encouraging learners to chase/transcribe text. Canonical speech is still required for grounding, correction handling, replay/debugging, and semantic decisions.

**Default direction:** Adaptive representation: `QUIET`, `TEXT`, `FOCUS`, `RELATE`, or `TRANSFORM`.

**Revisit when:** user testing shows that a specific context requires persistent full captions as the primary learner experience. Full/plain caption mode may still exist as an accessibility, fallback, or explicit user mode.

## 2026-08-31 — AI interprets; deterministic runtime executes

**Decision:** AI should emit bounded semantic and pedagogical intent. It should not freely choose visual implementation details such as arbitrary colours, motion curves, durations, layouts, or effects.

**Rationale:** The product needs AI for uncertain interpretation of live teaching, not for predictable execution. Deterministic compilation keeps behaviour testable, coherent, and safe from visual drift.

**Current semantic grammar:** `QUIET`, `TEXT`, `FOCUS`, `RELATE`, `TRANSFORM`.

**Current execution principle:** validated semantic intent → deterministic compiler → bounded renderer.

**Revisit when:** repeated real teaching cases demonstrate that bounded deterministic grammar cannot express useful representations without unacceptable authoring complexity.

## 2026-08-31 — QUIET / NONE are first-class decisions

**Decision:** The system must be able to decide that no learner-visible intervention is warranted.

**Rationale:** AI-native behaviour is not measured by generation frequency. Selective silence is necessary to preserve attention and prevent a live teaching surface from becoming visually noisy.

**Revisit when:** never by default. Individual display modes may intentionally expose more text, but adaptive mode must retain a first-class quiet state.

## 2026-08-31 — Learner cues are a separate intent channel

**Decision:** Learner-action timing is represented separately from content representation.

**Initial learner grammar:** `NONE`, `NOTE`, `REFLECT`.

**Rationale:** "What should the learner notice?" and "What should the learner do now?" are related but distinct decisions. Keeping them separate prevents content FX from being overloaded with pedagogical control.

**Boundary:** Learning cues must remain sparse. They must not turn CueLayer into an always-on tutor, generate answers, or create reflection tasks without a grounded pedagogical handoff.

**Revisit when:** real classroom evidence supports additional recurring learner-state transitions that cannot be represented by the current grammar.

## 2026-08-31 — NOTE may be partially deterministic

**Decision:** A `NOTE` opportunity may be triggered by deterministic runtime state when a useful semantic structure has visibly settled; it does not always require a separate LLM decision.

**Rationale:** The AI may already have established that a structure is pedagogically meaningful. Once its progression reaches a settled state, note timing is often a predictable execution concern.

**Revisit when:** dogfooding shows that settled semantic structures are a poor proxy for note-worthiness.

## 2026-08-31 — REFLECT requires grounded pedagogical evidence

**Decision:** `REFLECT` should be emitted only when teacher speech/context indicates a genuine handoff of cognitive work to learners, such as a question, prediction request, comparison prompt, deliberate pause for thinking, or equivalent instructional move.

**Rationale:** CueLayer should not interrupt teaching by inventing unsolicited reflection questions or turning ordinary explanation into tutoring prompts.

**Revisit when:** later Teaching State and validated classroom data support safe proactive reflection behaviour.

## 2026-08-31 — Base live experience must not depend on LLM latency

**Decision:** Presentation capture and canonical speech acquisition must continue independently of AI inference. Stale AI results are discarded rather than replayed or allowed to rewind the learner-visible state.

**Rationale:** AI is a probabilistic enhancement layer. Model latency/failure must not stall a live class.

**Revisit when:** no planned reason. This is a core reliability boundary.

## 2026-08-31 — Build vertical slices, not platform infrastructure

**Decision:** Development proceeds in usable vertical slices: Presentation Proxy → live canonical speech → adaptive semantic loop → sparse learner cues → dogfood hardening.

**Rationale:** The immediate success criterion is a teacher completing a real 20–30 minute session. Accounts, billing, dashboards, cloud persistence, native packaging, and production-scale infrastructure do not currently advance that criterion.

**Revisit when:** a current user-facing requirement cannot be implemented responsibly without the deferred infrastructure.

## 2026-08-31 — Teaching State is important but not an Alpha blocker

**Decision:** The architecture should remain compatible with a future evolving Teaching State across utterances, but First Usable Alpha may make bounded decisions from recent/stable speech context without a full persistent teaching model.

**Rationale:** Cross-utterance semantic accumulation is likely to become a major CueLayer capability, but implementing it before the live product loop exists would increase scope and delay dogfooding.

**Revisit when:** the Alpha loop is stable enough that isolated utterance decisions become the dominant product limitation.