# Speechmatics live grounding

This slice adds a live speech subsystem to `/session` without coupling it to presentation transport or the learner surface.

## Runtime configuration

- Speechmatics Realtime endpoint: `wss://global.rt.speechmatics.com/v2`
- Model: `enhanced`
- Language pack: `cmn_en` (Mandarin & English bilingual)
- Audio: raw `pcm_f32le`, 16 kHz, using Speechmatics' browser `PCMRecorder` AudioWorklet
- Latency: `max_delay: 1.5`, `max_delay_mode: flexible`
- Transcript delivery: `enable_partials: true`
- Vocabulary: `additional_vocab` fixture for nine representative Chemistry terms

The temporary token endpoint uses `SPEECHMATICS_API_KEY` only on the server to mint 60-second Realtime JWTs. It is implemented for Vercel at `api/speechmatics/token.ts`, with equivalent Vite development middleware. Vite explicitly loads `.env*` through `loadEnv`; no `VITE_` credential is used. `.env*` is ignored while `.env.example` remains committed.

For Alpha, deploy behind private-preview or deployment-level access protection. The endpoint deliberately does not introduce accounts, rate limits, or a wider authentication system, so a public deployment could otherwise be used to mint temporary keys and consume ASR credit.

## Canonical speech contract

```ts
type CanonicalSpeechState = {
  committed: Array<{ id: string; text: string; words: SpeechWord[] }>;
  provisional?: { id: string; text: string; words: SpeechWord[] };
};
```

Speechmatics `AddPartialTranscript` replaces `provisional`; `AddTranscript` appends one committed segment and clears it. Words retain provider wording, ordering, confidence, and millisecond timings. CueLayer neither translates nor edits code-switched text.

## Reuse audit

### Browser capabilities reused

- `navigator.mediaDevices.getUserMedia`, through Speechmatics' browser recorder
- browser `AudioContext` and `AudioWorklet` for off-render-path PCM capture

### Speechmatics capabilities reused

- Realtime recognition, socket lifecycle, and provider cleanup via `@speechmatics/real-time-client-react`
- recorder lifecycle, `isRecording` / `isMuted` state, mute controls, and AudioWorklet microphone capture via `@speechmatics/browser-audio-input-react`
- server-defined partial/final transcript semantics
- server word timings and confidence
- `cmn_en` bilingual recognition
- `additional_vocab` custom dictionary
- flexible punctuation/smart formatting and endpoint/finalization behavior
- browser-safe temporary Realtime JWT authentication

### CueLayer-owned code

- a small provider-message adapter
- speech-faithful canonical policy
- session/run identity and independent failure state
- temporary inspection surface and development counters

### Custom commodity logic

None. CueLayer does not implement VAD, endpointing, generic reconciliation, generic audio lifecycle, or WebSocket protocol handling. The one-line official `usePCMAudioListener` → `sendAudio` handoff passes the AudioWorklet's raw PCM buffer to the official realtime hook; it is not a CueLayer transport implementation.
