# CueLayer

CueLayer is an AI-native presentation layer for teaching. See [docs/PRODUCT_CHARTER.md](docs/PRODUCT_CHARTER.md) for the durable product model.

This repository currently implements a bounded semantic-renderer vertical slice: phrase-level targeting, timing, progression, and deterministic `FOCUS`, `RELATE`, and `TRANSFORM` effects. See [docs/SPEECH_FIRST_SCOPE.md](docs/SPEECH_FIRST_SCOPE.md) for the phase-specific renderer validation scaffold.

## Product and renderer contracts

Product-level planning can choose:

`QUIET | TEXT | FOCUS | RELATE | TRANSFORM`

These are planner-level display intents. They compile into renderer state and bounded effect cues; they are not necessarily renderer cue kinds. The current renderer contract covers `FOCUS`, `RELATE`, and `TRANSFORM`, while `QUIET` and `TEXT` can resolve through ordinary renderer state.

```ts
type CaptionClip = {
  id: string;
  captionText: string;
  words: TimedWord[];
  cues: EffectCue[];
};
```

Within the renderer scaffold, `captionText` remains the canonical authored comparison surface. FX may use semantically equivalent notation while preserving grounded meaning.

## Current implementation

- FX Lab and continuous renderer fixtures
- phrase-level caption segmentation and target grounding
- `FOCUS`, `RELATE`, and `TRANSFORM` renderers
- timing and process progression
- 9701 CueCaption semantic skill and evaluation assets

## Semantic caption planner

Committed canonical speech now feeds a small, stateful semantic-caption runtime: one temporary subtitle episode, optionally one teacher-locked episode, and one independent short learner cue. Validated display intent (`QUIET | TEXT | FOCUS | RELATE | TRANSFORM`) compiles deterministically into the existing renderer grammar, while learner intent remains independent (`NONE | NOTE | REFLECT`) even when display is `QUIET`. Press Space during a session to keep or release the current semantic caption.

Set server-only `OPENAI_API_KEY` to enable the OpenAI Responses structured-output planner (default model `gpt-5.6-luna`; override with `OPENAI_MODEL`). The live planner runtime is intentionally OpenAI-only; the earlier DeepSeek runtime path is no longer part of this contract. The same single model call applies the generated 9701 CueCaption policy and chooses bounded display/learner intent; Speechmatics finals remain immutable provenance. Planner failure leaves presentation capture, live speech, and the last safe caption intact. See [Semantic Caption Planner](docs/TEACHING_STATE_PLANNER.md) for the lifecycle, grounding, coalescing, compiler, policy-source sync, demo trace, and reuse audit.

The renderer is designed to become the deterministic execution layer beneath live speech, Teaching State, adaptive display planning, learner cues, and presentation transport.

## Live Speech Grounding

`/session` can now enable a separate live speech subsystem beside Presentation Proxy. It uses Speechmatics Realtime with the `enhanced` model, the `cmn_en` Mandarin/English bilingual pack, partial transcripts, flexible punctuation formatting, a 1.5-second final delay, and a compact Chemistry custom dictionary.

The permanent Speechmatics key stays server-side. Set `SPEECHMATICS_API_KEY` from [`.env.example`](.env.example); the browser requests a 60-second Realtime temporary key from `/api/speechmatics/token`, implemented only by [`api/speechmatics/token.ts`](api/speechmatics/token.ts).

The browser uses Speechmatics' current official React realtime and PCM AudioWorklet integrations. Provider messages terminate in [`speechmatics-adapter.ts`](src/session/speechmatics-adapter.ts), then CueLayer stores speech-faithful `CanonicalSpeechState` as planner provenance. Presentation capture stays independent if speech cannot start or disconnects.

Live verification requires a configured Speechmatics key and browser microphone permission. Keep an Alpha deployment behind private-preview or deployment-level access protection: its temporary-token endpoint is intentionally not an account or rate-limit system. Normal `/session` never shows the continuous ASR transcript.

## Durable teaching-session trace

Every `/session` URL receives a `sessionId`. The live path writes one sanitized, append-only execution trace into browser IndexedDB, connecting Speechmatics text events to canonical commits, planner/API calls, validation, compiler output, and final renderer state. `/session?debug=speech` reads that local persistent evidence and exports the complete session as `cuelayer-session-<sessionId>.jsonl`; no database connectivity is involved.

IndexedDB is the First Usable Alpha durable trace source of truth. It retains the current active session and the five most recent explicitly completed sessions. Each page load owns a fresh writer identity, while End Session flushes and completes the current trace and Start another session creates a new session identity. A bounded serialized queue retries transient writes without allowing persistent storage failure to consume unbounded memory. Server APIs return sanitized, stable provider facts with their normal result; the browser enqueues those facts asynchronously so trace storage never delays token delivery or planner decisions. IndexedDB failure is visible as trace degradation but never disables teaching, speech, planning, or rendering.

Completed sessions can be serialized as immutable diagnostic bundles (`session` plus ordered `events`). There is deliberately no configured remote sink in Alpha. External dogfood can later upload one completed bundle for support without changing trace creation or introducing continuous synchronization.

Trace sanitization removes credentials and all audio-shaped or binary values. Speechmatics PCM/audio frames remain transient and are never placed in the local trace. Only transcript text and connection lifecycle metadata are persisted. The trace drawer presents a deterministic full-session semantic/lifecycle narrative, plus a bounded recent raw-evidence window; export walks IndexedDB in ordered chunks rather than materializing and joining the complete trace in one JavaScript string.

## Development and deployment boundary

`/api` contains only two Vercel HTTP entrypoints: planner decision and Speechmatics token. They return their sanitized trace facts to the browser with their normal results; neither writes or reads a remote trace store. Server implementation, generated policy, fixtures, and tests live under `/server`. Deployment directories contain deployment entrypoints, not implementation modules.

`npm run dev` is frontend-only Vite development for renderer and fixture work. Use `npm run dev:full` (`vercel dev`) for Speechmatics, OpenAI Luna, local trace capture, Human Trace, export, and real microphone sessions; this executes the same endpoint implementations as Preview and deployment.

Teaching availability must not depend on observability availability. Trace degradation is visible and recoverable, but it never disables speech, canonical captions, Luna planning, or rendering.
