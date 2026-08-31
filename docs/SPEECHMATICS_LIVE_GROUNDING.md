# Speechmatics live grounding

This slice adds a live speech subsystem to `/session` without coupling it to Presentation Proxy or the semantic renderer.

## Runtime configuration

- Speechmatics Realtime endpoint: `wss://global.rt.speechmatics.com/v2`
- Model: `enhanced`
- Language pack: `cmn_en` (Mandarin & English bilingual)
- Audio: raw `pcm_f32le`, 16 kHz, using Speechmatics' browser `PCMRecorder` AudioWorklet
- Latency: `max_delay: 1.5`, `max_delay_mode: flexible`
- Transcript delivery: `enable_partials: true`
- Vocabulary: `additional_vocab` fixture for nine representative Chemistry terms

The temporary token endpoint uses `SPEECHMATICS_API_KEY` only on the server to mint 60-second Realtime JWTs. It is implemented for Vercel at `api/speechmatics/token.ts`, with equivalent Vite development middleware. No `VITE_` credential is used.

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

- Realtime recognition and WebSocket lifecycle via the official JS client
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

None. CueLayer does not implement VAD, endpointing, generic reconciliation, audio conversion, or WebSocket protocol handling. A 500 ms recorder liveness check is only used because the current browser recorder does not expose its microphone tracks; it releases local resources if the underlying stream is no longer active.
