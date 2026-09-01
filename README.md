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

Set server-only `DEEPSEEK_API_KEY` to enable DeepSeek's OpenAI-compatible Responses structured-output planner, or `OPENAI_API_KEY` to use OpenAI Responses (default model `gpt-5.6-luna`). The same single model call applies the generated 9701 CueCaption policy and chooses bounded display/learner intent; Speechmatics finals remain immutable provenance. Planner failure leaves presentation capture, live speech, and the last safe caption intact. See [Semantic Caption Planner](docs/TEACHING_STATE_PLANNER.md) for the lifecycle, grounding, coalescing, compiler, policy-source sync, demo trace, and reuse audit.

The renderer is designed to become the deterministic execution layer beneath live speech, Teaching State, adaptive display planning, learner cues, and presentation transport.

## Live Speech Grounding

`/session` can now enable a separate live speech subsystem beside Presentation Proxy. It uses Speechmatics Realtime with the `enhanced` model, the `cmn_en` Mandarin/English bilingual pack, partial transcripts, flexible punctuation formatting, a 1.5-second final delay, and a compact Chemistry custom dictionary.

The permanent Speechmatics key stays server-side. Set `SPEECHMATICS_API_KEY` from [`.env.example`](.env.example); the browser requests a 60-second Realtime temporary key from `/api/speechmatics/token`. The repository includes a Vercel-compatible endpoint at [`api/speechmatics/token.ts`](api/speechmatics/token.ts) and the same endpoint for local Vite development.

The browser uses Speechmatics' current official React realtime and PCM AudioWorklet integrations. Provider messages terminate in [`speechmatics-adapter.ts`](src/session/speechmatics-adapter.ts), then CueLayer stores speech-faithful `CanonicalSpeechState` as planner provenance. Presentation capture stays independent if speech cannot start or disconnects.

Live verification requires a configured Speechmatics key and a browser microphone permission. Keep an Alpha deployment behind private-preview or deployment-level access protection: its temporary-token endpoint is intentionally not an account or rate-limit system. Normal `/session` never shows the continuous ASR transcript. In local development, `/session?debug=speech` explicitly enables committed/provisional inspection, planner diagnostics, and a bounded in-memory ASR → commit → planner gate → planner → compile → render trace. The trace is not persisted or sent anywhere and disappears on refresh.
