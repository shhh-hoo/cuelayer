# Durable Session Trace

## Purpose

CueLayer needs durable local evidence for one teaching session without allowing observability to alter live speech, interpretation, or rendering. The trace is stored locally and can be exported from the explicit debug surface.

Trace is diagnostic authority only. It is never the source of lesson truth and never drives replayable Teaching State.

## Non-negotiable execution boundary

The Speechmatics PCM handoff remains direct:

```text
AudioWorklet → usePCMAudioListener → sendAudio
```

No trace write, PCM scan, serialization, React update, IndexedDB transaction, or diagnostic callback may block or run ahead of that transport handoff.

## Runtime path

```text
speech / interpretation / learner-surface fact
            ↓
      TraceWriter.emit
  assign source-local sequence
  enqueue or coalesce partial
            ↓
bounded asynchronous batch
            ↓
local durable session trace
```

React is not the trace message bus. The debug viewer reads bounded snapshots only on the explicit debug route.

## Event policy

The trace may retain:

- session lifecycle;
- speech final / canonical checkpoint facts;
- interpretation request, provider, normalization, validation, and accepted-step facts;
- durable domain transitions and reduced state snapshots;
- learner-surface render and visibility facts;
- bounded latency and transport metadata;
- explicit gap events when diagnostic evidence is dropped or correlation is lost.

Raw credentials, binary/audio media, PCM, secrets, and unsupported private payloads must not be persisted.

High-frequency partials and transport telemetry may be coalesced. Critical AI-decision and accepted-domain facts must not be silently discarded merely to satisfy an arbitrary bytes-per-minute target.

## Session lifecycle

- session identity survives reload where the session contract requires it;
- each page/runtime source receives its own source instance identity and local monotonic sequence;
- completed sessions remain readable/exportable and cannot accept later appends;
- schema evolution remains additive where practical and legacy trace exports remain readable when compatibility is promised.

The exact number of retained sessions and storage bounds are executable configuration, not product semantics.

## Full-cycle AI audit contract

Each interpretation should be correlatable across the available execution chain:

```text
checkpoint
→ request
→ provider contract/request/response
→ normalized proposal
→ validation result
→ accepted domain event
→ reduced state
→ learner-surface render
```

Provider transport and structured parsing are distinct observable stages. Failures retain every safe fact that was already available before the failure.

The audit trace may preserve exact safe DTOs and stable digests where implemented. Sanitization must redact credentials and omit media before persistence.

The Lesson Event Log and diagnostic trace have different jobs:

- Lesson Event Log = domain truth and replay authority.
- Trace = observable execution lifecycle and debugging evidence.

Do not collapse them.

## Browser latency instrumentation

Browser latency instrumentation is best-effort diagnostic evidence. It must not drive scheduling, state, or rendering.

Useful boundaries include:

- speech/ASR observation;
- checkpoint close/commit;
- interpretation admission/start/provider completion;
- validation and durable state publication;
- renderer commit;
- post-frame DOM visibility observation.

Browser and server clocks must not be subtracted across clock domains without an explicit mapping. Missing, invalid, hidden, superseded, or unobservable intervals remain unavailable rather than being fabricated.

DOM visibility is not physical display latency and not learner attention. CSS visibility, viewport geometry, occlusion, hardware scanout, and human perception are different quantities.

No waveform scanning or audio-media persistence is authorized by latency instrumentation.

## Bounded diagnostics

Trace memory, correlation maps, and queues must be bounded. If queue pressure or correlation eviction loses evidence, the trace must emit an explicit gap fact when possible rather than silently pretending completeness.

Observer failure must be isolated from speech transport, interpretation, domain persistence, and rendering.

## Verification obligations

Trace changes must preserve these guarantees:

1. speech transport does not wait for trace work;
2. diagnostic persistence failure cannot stop teaching execution;
3. credentials/audio are never added to the trace;
4. accepted domain events remain distinct from diagnostic attempts;
5. trace gaps are explicit where supported;
6. completed session exports remain readable according to the supported trace schema;
7. browser latency claims state their measurement boundary and limitations;
8. trace data never becomes replay authority.

Manual session playback and export procedures live in `docs/RUNBOOK.md`.
