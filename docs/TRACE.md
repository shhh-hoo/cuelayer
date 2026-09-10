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

## Core live trace (M3)

The existing v3 trace envelope gains additive `core.*` event types and optional `coreRequestId`, `knowledgeRevision`, Core/entity identity and `verificationRequestIndex` correlation. Legacy v2/v3 records and Board event names retain their original meaning. The trace viewer displays Core request identity and the full expandable record; Core authority never emits legacy Board state aliases.

The production Core host passes its existing trace emitter to `CoreLiveSession`. The reconstructable chain is:

```text
core.checkpoint_committed
→ core.request (bounded context, reference map, diagnostics/digest)
→ core.provider_request (contract/policy identity, exact safe envelope/digest)
→ core.provider_response (raw output text, provider metadata/digest)
→ core.proposal_normalized
→ core.validation
→ core.accepted (persisted steps, operations, Cue delta, full event IDs/digest)
→ core.published (independent revisions, processed sequence, state digest)
```

`core.published` identifies `core-authority` and explicitly records that no compatibility projection is present. Entity IDs are carried in the bounded request reference map and accepted operations/events; provider handles never become durable identity. Publication records exist only after event persistence. `core.request_failed` records the provider/normalization/validation/persistence stage separately from failure category; an upstream failure does not pretend semantic validation ran. `core.context_blocked` records failed mandatory closure/budget admission. `core.finalization` distinguishes draining, incomplete and ended.

Context diagnostics record version, characters/token estimate, Core/candidate/entity/evidence counts, Cue presence, optional clipping and both base revisions. Context is bounded by the reviewed builder, never a second state store. Raw provider text is capped at 65,536 characters with an explicit truncation flag; responses above 131,072 characters are rejected before parsing. Trace preserves full bounded accepted DTOs/provenance and their safe digests. Malformed internal sidecar diagnostics are bounded independently. Credential/media sanitization runs before Core observers and again at trace persistence.

Verification has its own `core.verification` records correlated by session ID, Core request ID and original request index. States are enqueued, started, completed, failed, timeout, cancelled or dropped; unconfigured sinks and queue pressure have explicit reasons. `core.verification_dropped` records normalization drops after semantic acceptance. None of these records is a lesson event, evidence rule or scheduler pending checkpoint.

Payload construction, sanitization and listener failures are isolated from domain behavior. The existing bounded asynchronous `TraceWriter` remains the persistence path; no Core trace work is added to PCM/audio delivery. Missing/gapped trace cannot change replay or acceptance.

## Core shared-projector trace (M4C)

The same optional emitter and bounded local TraceWriter accept two additive records after the Core publication boundary:

- `core.representation`: accepted knowledge/Cue revisions and processed sequence; available candidate IDs; admitted candidate/artifact/payload/producer/capability bindings; committed evidence and accepted reference grounding; exact M4A projection/selected IDs; CREATE/UPDATE/PRESERVE/WITHDRAW changes; artifact revision/visibility and anchored Space assignment; production/revalidation rejection reasons.
- `core.projector`: the accepted revisions at rendering, rendered/degraded status, explicit failure reason, measured Space/local/persistent geometry, temporary composition, visible and failed artifact IDs, rendered boxes, camera, inspection, motion and automatic-fit status.

Join records by session and accepted revisions/processed sequence to `core.published` and its accepted event IDs. A runtime subscription can emit representation diagnostics before the controller finishes emitting `core.published`; timestamps alone do not define semantic authority. The runtime subscription is already after durable commit. Initial replay records artifact creation without manufacturing new semantic events. Intermediate animation frames are not traced; settled geometry and manual inspection observations are diagnostic proxies, not evidence of learner comprehension or hardware display visibility.

Malformed production, missing capabilities/payloads, invalid grounding, stale retained parts, invalid measurement, unresolved pressure, renderer failure/empty mount and insufficient automatic fit are representation/spatial failures. They do not roll back accepted Core state, reopen evidence or invoke a provider. No new trace persistence or audio-hot-path work is introduced; emitter failures cannot reset canonical artifact history or change acceptance.

## Production session domain

`session.domain` records `core` or `legacy` and `source: "lesson-domains"` after the durable domain gate resolves and before the selected semantic host mounts. It joins the Core chain above to the normal session identity; legacy restoration retains its historical trace generation. The dedicated `lesson-domains` claim is restoration authority. Missing trace, trace-store failure or a completed trace cannot infer, change or replace a lesson's semantic domain/identity. An ended lesson's trace remains readable and sealed; reopening it does not create another lesson.

The Core HTTP seam returns safe request/response diagnostics for the same reviewed provider envelope/parser. The browser retains the local request binding and emits normalization, validation, accepted event IDs and publication only through the shared controller. M4C representation and projector records continue from persisted publication. No compatibility Board state or synthetic legacy identity is emitted by Core.

## Core latency and pressure diagnostics (M6a)

Core requests retain the existing correlation `coreRequestId` across browser and server diagnostics. `core.request.scheduledAt` records the scheduler timestamp; `core.http` records HTTP start/completion and elapsed time including response-body parsing. `core.provider_request.startedAt` marks the provider call start. `core.provider_response` adds `startedAt`, `completedAt`, `elapsedMs`, transport `outcome` and optional `abortSource`; a successful transport response can still fail parsing/validation. `core.endpoint` records the server endpoint start/completion, total elapsed time and outcome. `core.attempt_completed` records `scheduledAt`, completion, total client/Core elapsed time (including validation/persistence), outcome (`accepted`, `needs_context`, `failure`) and optional abort source. Wall-clock timestamps locate events; elapsed values use each process's monotonic clock, so do not subtract browser/server timestamps as a latency measurement.

The diagnostic abort sources are `provider_deadline`, `client_deadline`, `client_disconnect`, `session_cancellation`, `stale_speech_generation`, and `provider_transport_failure`. The last includes other provider/transport and provider-output failures; existing failure category/stage records still explain semantic validation and persistence. Server/provider timeout remains `core-provider-timeout`; the outer client timer is now explicitly `core-client-timeout`. The centralized Alpha defaults are 12,000 ms provider/server and 14,000 ms client, with 2,000 ms grace. A browser disconnect may prevent buffered server diagnostics reaching that browser; it cannot imply provider success. Client/session cancellation is recorded locally, and the server classifies its disconnect when it settles. No new logging service or semantic authority is introduced.

`core.provider_request.weight` records serialized request characters and UTF-8 bytes, the existing `ceil-json-characters-divided-by-four` estimate, dynamic context characters and its same rough estimate, entity count, new evidence checkpoint count, and requested maximum output tokens. The already-built provider request and budget serialization are reused. These are estimates, not tokenizer measurements. `core.provider_response.response` preserves actual `model` and provider `usage`, including `input_tokens`, `output_tokens`, `input_tokens_details.cached_tokens` and `output_tokens_details.reasoning_tokens` when returned. Missing provider usage remains missing. No model, prompt, schema, reasoning effort or output allowance changed.

Both `core.request.queue` and `core.attempt_completed.queue` snapshot the existing scheduler/runtime: `pendingCheckpointCount` includes in-flight evidence until accepted, `oldestPendingAgeMs` derives from its durable checkpoint commit timestamp (null when empty), `requestCheckpointCount` describes that attempt, and `processedThroughSequence`, `consecutiveFailures`, `paused`, `backingOff` explain progress and retry pressure. The completion snapshot is taken after settlement/backoff changes and before the next pump. These observations never consume evidence or choose scheduling behavior; trace construction, sanitization and listener exceptions remain isolated from acceptance and failure recovery.
