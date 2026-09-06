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

## Browser latency instrumentation

The browser path emits additive trace v3 events through the existing bounded, asynchronous IndexedDB trace system. It neither awaits trace persistence nor drives scheduling/state. Correlation uses existing sessionId → speechRunId/speechEventId → canonical finalId → checkpointId → requestId → accepted step and Board/Cue revisions → affected DOM item IDs/renderId. No CLI path emits a DOM latency claim.

| Field | Recorded boundary / clock |
| --- | --- |
| `speechEndMs` | ASR word-end offset in the run's audio timeline; null without word timing. |
| `speechObservedAt` | Audio offset mapped to the browser's observation of PCM delivery, after the official transport listener. This is a proxy, **not physical speech capture time**. |
| `asrFinalAt` | Browser provider-final callback; checkpoint uses the latest final arrival among its source finals. |
| `checkpointClosedAt` | Browser hook observes the closed canonical span before durable commit; not a new segmentation decision or original reducer close timestamp. |
| `checkpointCommittedAt` | Durable checkpoint commit returns. |
| `plannerEligibleAt` | Committed checkpoint enters pending; admission does not imply immediate dispatch while single-flight/recovery/budget gates apply. |
| `plannerStartedAt` | Existing scheduler work dispatch begins. |
| `providerFinishedAt` / `timeoutAt` | Browser receives successful interpreter response / observes timeout. Server audit separately supplies SDK start/end epochs and monotonic duration. |
| `validationAt` | Production validator returns (or existing early acceptance guard rejects). |
| `proposalAcceptedAt`, `stateReducedAt` | Durable accepted event(s) have been persisted and reduced state published, before notifying subscribers. They do not mean speculative reduction or DOM display. |
| `rendererCommittedAt` | Actual TeachingSurfaceLayer layout effect after React commit. |
| `domVisibleAt` | Post-two-frame CSS/viewport observation of the specific changed items, or observed removal. Not merely presence of the surface root. |
| `pendingCount`, `oldestPendingAgeMs`, `batchSize` | Observations of existing pending work at admission/dispatch/reduction/failure; age uses the existing durable commit wall-clock basis. |
| `retryAttempt` | One-based count of this checkpoint's observed dispatches in this page, including the first attempt. `attemptCountScope` explicitly excludes unobserved attempts before restore or correlation eviction. |

Browser phase timestamps use `performance.timeOrigin + performance.now()`. Server SDK duration uses its own `performance.now()` difference; server epochs are never subtracted from browser epochs. `providerTimingScope` distinguishes server SDK duration from browser round-trip fallback. Provider → state uses browser response observation → durable state publication, so HTTP time is not silently assigned to state reduction.

Each `latency.checkpoint` snapshot includes nullable derived fields: `speechToAsrMs`, `asrToCommitMs`, `commitToPlannerStartMs`, `providerMs`, `providerToStateMs`, `stateToDomMs`, `speechToDomMs`. Missing or negative/invalid intervals stay null. Speech-based values are PCM-delivery-referenced proxies: chunk duration is recorded as mapping granularity, **not a bound on device/driver/worklet buffering or total acoustic latency**. No waveform is scanned, stored or exported. The official `usePCMAudioListener(sendAudio)` remains direct and registered before the separate metadata observer.

`latency.stage` retains each attempt/failure; snapshots must not be counted as independent requests. `provider.request_snapshot.timing` retains server timing alongside existing safe audit/usage. Existing request output, validation and accepted-event records remain the evidence for semantic review. A timeout is incomplete execution, not semantic failure; validation success followed by storage failure has no durable acceptance timestamp.

Visibility is bounded best-effort observation: CSS-hidden Support/Retained nodes do not prevent an unrelated visible Active update from being measured. A hidden affected Support, background document, offscreen item, missing node, KEEP, superseded intermediate revision, or unavailable frames produces no invented DOM completion. Intermediate steps reduced in one atomic request may never render. A removal can be observed even when the final surface is empty. Hints have their own DOM identity. The observer samples once per render (two frames, 1-second fallback); it does not poll until a hidden item eventually becomes visible. Occlusion, physical pixels, human attention and display hardware latency remain **unverified**; pointer-events:none makes hit testing unsuitable. `measurementBasis` is `post-frame-css-geometry`.

Memory is bounded to 256 checkpoint/final correlations and 512 PCM metadata chunks. Correlation eviction emits `latency.gap`; the existing trace queue still emits `trace.gap` on dropped events. Missing joins remain unavailable. Observer failures are isolated, no diagnostic operation awaits I/O in the transport/planner/renderer path, and no credentials/audio are added to traces.

Coverage: mocked SDK success/failure durations; browser hook phase ordering; a throwing trace sink leaves acceptance unchanged; post-frame React DOM tests with explicitly synthetic geometry; per-item hidden Support; timeout/retry, restore/run identity, no durable acceptance on failed persistence, KEEP/superseded/missing clocks, bounded correlation, PCM metadata and safe serialization. These are offline tests, not measured live latency.


Manual playback and export: [replay runbook](LESSON_TRANSCRIPT_REPLAY.md).
