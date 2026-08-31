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

The renderer is designed to become the deterministic execution layer beneath live speech, Teaching State, adaptive display planning, learner cues, and presentation transport.

## Live Speech Grounding

`/session` can now enable a separate live speech subsystem beside Presentation Proxy. It uses Speechmatics Realtime with the `enhanced` model, the `cmn_en` Mandarin/English bilingual pack, partial transcripts, flexible punctuation formatting, a 1.5-second final delay, and a compact Chemistry custom dictionary.

The permanent Speechmatics key stays server-side. Set `SPEECHMATICS_API_KEY` from [`.env.example`](.env.example); the browser requests a 60-second Realtime temporary key from `/api/speechmatics/token`. The repository includes a Vercel-compatible endpoint at [`api/speechmatics/token.ts`](api/speechmatics/token.ts) and the same endpoint for local Vite development.

The browser uses Speechmatics' `browser-audio-input` PCM AudioWorklet path and its realtime JavaScript client. Provider messages terminate in [`speechmatics-adapter.ts`](src/session/speechmatics-adapter.ts), then CueLayer stores only speech-faithful `CanonicalSpeechState` for the temporary inspection surface. Presentation capture stays independent if speech cannot start or disconnects.

Live verification requires a configured Speechmatics key and a browser microphone permission. The temporary text surface is diagnostic infrastructure, not the intended permanent learner-visible UI.
