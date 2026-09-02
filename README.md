# CueLayer

CueLayer is an AI-native presentation layer for teaching. See [docs/PRODUCT_CHARTER.md](docs/PRODUCT_CHARTER.md) for the durable product model.

For the current live-teaching execution model, including lesson evidence, event sourcing, Teaching State, interpretation windows, context policy, scheduler semantics, Board/Cue runtime, and PR10–PR11 acceptance gates, see [docs/LIVE_TEACHING_SYSTEM_SPEC.md](docs/LIVE_TEACHING_SYSTEM_SPEC.md). It is the live-runtime execution authority subordinate to the Product Charter.

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

## Legacy semantic caption runtime

The currently implemented `/session` path still contains the earlier semantic-caption runtime: one temporary subtitle episode, optionally one teacher-locked episode, and one short learner cue. That implementation remains useful as renderer/planner history, but it no longer defines the target live product architecture. The migration target is the lossless lesson-event → Teaching State → Teaching Board/Teaching Cue model in [LIVE_TEACHING_SYSTEM_SPEC.md](docs/LIVE_TEACHING_SYSTEM_SPEC.md).

Set server-only `DEEPSEEK_API_KEY` to enable DeepSeek's OpenAI-compatible Responses structured-output planner, or `OPENAI_API_KEY` to use OpenAI Responses (default model `gpt-5.6-luna`). Speechmatics finals remain immutable provenance. See [Semantic Caption Planner](docs/TEACHING_STATE_PLANNER.md) for the legacy runtime's lifecycle, grounding, coalescing, compiler, policy-source sync, and historical reuse audit.

The renderer remains a deterministic execution asset beneath live speech, Teaching State, adaptive representation, learner cues, and presentation transport.

## Live Speech Grounding

`/session` can now enable a separate live speech subsystem beside Presentation Proxy. It uses Speechmatics Realtime with the `enhanced` model, the `cmn_en` Mandarin/English bilingual pack, partial transcripts, flexible punctuation formatting, a 1.5-second final delay, and a compact Chemistry custom dictionary.

The permanent Speechmatics key stays server-side. Set `SPEECHMATICS_API_KEY` from [`.env.example`](.env.example); the browser requests a 60-second Realtime temporary key from `/api/speechmatics/token`. The repository includes a Vercel-compatible endpoint at [`api/speechmatics/token.ts`](api/speechmatics/token.ts) and the same endpoint for local Vite development.

The browser uses Speechmatics' current official React realtime and PCM AudioWorklet integrations. Provider messages terminate in [`speechmatics-adapter.ts`](src/session/speechmatics-adapter.ts), then CueLayer stores speech-faithful `CanonicalSpeechState` as planner provenance. Presentation capture stays independent if speech cannot start or disconnects.

Live verification requires a configured Speechmatics key and a browser microphone permission. Keep an Alpha deployment behind private-preview or deployment-level access protection: its temporary-token endpoint is intentionally not an account or rate-limit system. Normal `/session` should not expose continuous ASR transcript as the learner-facing product surface; `/session?debug=speech` is the diagnostic surface for committed/provisional inspection and trace tooling.
