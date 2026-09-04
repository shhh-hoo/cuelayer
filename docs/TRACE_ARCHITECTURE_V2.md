# Durable Session Trace v3 (v2 archives retained)

## Purpose

CueLayer needs durable local evidence for one teaching session without allowing observability to alter live speech, planning, or rendering. The trace is stored only in the browser's IndexedDB and can be exported as ordered JSONL from `/session?debug=speech`.

## Non-negotiable execution boundary

The Speechmatics PCM handoff remains exactly:

```text
AudioWorklet → usePCMAudioListener → sendAudio
```

No trace write, PCM scan, allocation, serialization, React update, IndexedDB transaction, or diagnostic callback may run before or inside that transport handoff. `AudioAdded` provider acknowledgements are counted with scalar O(1) operations and emitted once per second by a separate timer.

## Runtime path

```text
speech / interpretation / learner-surface fact
            ↓
      TraceWriter.emit
  assign source-local sequence
  enqueue or coalesce partial
            ↓
250 ms or 64-event batch boundary
            ↓
one IndexedDB transaction per batch
            ↓
ordered local session event store
```

React is not the trace message bus. Normal `/session` retains no durable event array in component state. The debug viewer reads a bounded snapshot from IndexedDB at one-second intervals only while the explicit debug route is active.

## Event policy

- Critical: session lifecycle, speech final, canonical final/span, interpretation outcome, learner-surface render.
- Raw: Speechmatics partial transcript snapshots. Rapid revisions for the same speech run are coalesced before persistence.
- Aggregate: one-second and final-run `AudioAdded` delivery summaries.
- Queue pressure is never silent. Dropped evidence produces a durable `trace.gap` event when storage recovers.
- Ordinary diagnostic payloads are bounded. Typed audit snapshots are complete: they retain the full interpretation request/timeline, provider contract/envelope/output, normalized proposal, validation fact, and Teaching State snapshots. Both paths redact credentials and omit binary/audio media.
- Trace volume is measured and reported, but no arbitrary MiB/min cap may silently discard a critical AI-decision event. High-frequency partial and transport telemetry remains coalesced.

## Session lifecycle

- `sessionId` is carried in the URL and survives reload.
- Every page load receives a distinct `sourceInstanceId` and source-local monotonic sequence.
- Creating one session does not complete another session or another tab.
- A completed session is sealed against later appends. Reloading its URL creates a replacement session ID while preserving the completed trace for export.
- The current session and five most recent completed sessions are retained.
- Schema v3 is additive. Existing v2 JSONL remains exportable/readable as legacy records; no archive is destructively migrated.

## Merge gates

1. Typecheck, unit tests, and production build pass.
2. Firefox and Chromium each complete the same 60-second live microphone script on normal and debug routes.
3. No visible UI stall or latency that grows with run duration.
4. Trace writer normally produces no more than four IndexedDB flush cycles per second.
5. `AudioAdded` produces summaries, never one durable row per acknowledgement.
6. IndexedDB denial, quota failure, or blocked upgrade cannot stop speech, planning, or rendering.
7. JSONL explicitly contains `trace.gap` if queue pressure discarded evidence.
8. Completed sessions remain readable/exportable and cannot accept new events.

## Full-cycle AI audit contract

Each interpretation is correlated by request, checkpoint, lesson-event, and render identities in this durable order: `interpretation.request_snapshot` → `provider.contract_snapshot` → `provider.request_snapshot` → `provider.response_snapshot` → `interpretation.proposal_normalized` → `interpretation.validation_result` → `interpretation.step_accepted` → domain transition facts → `teaching_surface.rendered`.

The trace records the exact teaching-domain request, credential-free OpenAI request envelope, actual provider contract, raw structured output, normalized proposal, deterministic validation outcome, persisted lesson event identity, Teaching State before/after, and the plain state supplied to the learner surface. Every semantic audit fact has a canonical SHA-256 digest. Request, provider request/response, validation-result, lesson-event, and state digests are calculated over the exact safe DTO after the typed audit sanitizer has redacted secrets and omitted media—the same representation persisted to JSONL.

Provider transport and structured parsing are distinct observable stages. A safe response DTO (including response ID/model/status/usage and raw text) is captured immediately after transport succeeds. JSON/schema parsing and normalization then run against that captured response; their failures retain every response fact that was already available. Each request has exactly one terminal validation classification: accepted, rejected, provider error, structured parse error, or normalization error.

The Lesson Event Log and audit trace have different jobs. The Lesson Event Log is domain truth and replay authority. The audit trace is the observable AI decision lifecycle, never the domain source of truth.
