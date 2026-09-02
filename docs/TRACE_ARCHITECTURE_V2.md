# Durable Session Trace v2

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
speech / planner / renderer fact
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

- Critical: session lifecycle, speech final, canonical final/span, planner gate/outcome, renderer activation.
- Raw: Speechmatics partial transcript snapshots. Rapid revisions for the same speech run are coalesced before persistence.
- Aggregate: one-second and final-run `AudioAdded` delivery summaries.
- Queue pressure is never silent. Dropped evidence produces a durable `trace.gap` event when storage recovers.
- Payload projection is typed. A final sanitization boundary removes credentials, binary values, PCM, audio-shaped values, circular references, and excessive depth before IndexedDB receives a batch.

## Session lifecycle

- `sessionId` is carried in the URL and survives reload.
- Every page load receives a distinct `sourceInstanceId` and source-local monotonic sequence.
- Creating one session does not complete another session or another tab.
- A completed session is sealed against later appends. Reloading its URL creates a replacement session ID while preserving the completed trace for export.
- The current session and five most recent completed sessions are retained.
- The v2 database uses a new name and performs no expensive migration of earlier experimental trace data.

## Merge gates

1. Typecheck, unit tests, and production build pass.
2. Firefox and Chromium each complete the same 60-second live microphone script on normal and debug routes.
3. No visible UI stall or latency that grows with run duration.
4. Trace writer normally produces no more than four IndexedDB flush cycles per second.
5. `AudioAdded` produces summaries, never one durable row per acknowledgement.
6. IndexedDB denial, quota failure, or blocked upgrade cannot stop speech, planning, or rendering.
7. JSONL explicitly contains `trace.gap` if queue pressure discarded evidence.
8. Completed sessions remain readable/exportable and cannot accept new events.
