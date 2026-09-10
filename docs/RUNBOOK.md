# CueLayer Runbook

This document contains operational procedures for local development, session inspection, trace export, and explicitly authorized evaluation. It does not define product semantics.

## Local development

```sh
npm ci
npm run dev
```

Server-only environment values are documented in `.env.example`.

Current live development uses Speechmatics for realtime speech and OpenAI for teaching interpretation. Credentials must remain server-side; do not introduce `VITE_` client secrets.

## Learner and debug surfaces

- `/session` — normal learner surface.
- `/session?debug=speech` — explicit diagnostic surface for canonical speech / trace inspection and export.

The normal learner route must not automatically become a continuous transcript view.

## Speech path

The browser speech path must preserve the direct official PCM transport:

```text
AudioWorklet → usePCMAudioListener → sendAudio
```

CueLayer does not add custom VAD, endpointing, generic WebSocket protocol handling, or blocking trace work inside that handoff.

Current Speechmatics configuration is executable code/configuration. If documentation and code disagree, inspect the current implementation rather than treating this runbook as semantic authority.

## Session trace

Trace is local diagnostic evidence. Exported trace may include safe speech, checkpoint, request, provider, validation, accepted-event, state, render, and latency facts according to `docs/TRACE.md`.

Before sharing any trace externally, verify that it contains no credentials, audio/PCM, unsupported binary payloads, or private data that the task did not authorize sharing.

Trace is never domain replay authority.

## Repository validation

Run the repository checks appropriate to the change. For the current PR15 baseline these include:

```sh
npm run typecheck
npm test
npm run build
npm run eval:semantics:validate
npm run check:repo -- --clean
```

The clean check must leave the working tree unchanged. Generated evaluation output belongs under ignored `.cuelayer/` or `artifacts/`, not tracked source.

## Evaluation

Offline validation does not require provider calls:

```sh
npm run eval:semantics:validate
```

Paid provider evaluation, microphone/video playback, or private trace upload requires explicit task authorization. Do not infer authorization from a previous run, a command example, or the existence of credentials.

See `docs/EVALUATION.md` for the reproducible evaluation contract and compatibility boundary.

## Manual browser / audio diagnostics

When a task explicitly authorizes real browser/audio validation:

1. start from a clean working tree and record the exact branch/commit under test;
2. use the normal learner route unless the diagnostic specifically requires the debug route;
3. verify microphone permission and Speechmatics connection before interpreting downstream failures;
4. distinguish audio transport, ASR finalization, checkpoint commit, interpretation, validation, state publication, render, and DOM observation as separate stages;
5. export the trace only after the session if required;
6. do not classify synthetic/offline success as real microphone acceptance;
7. clean temporary local artifacts that are not intended evidence.

Browser/DOM latency observations are diagnostic proxies, not physical capture/display latency or human attention measurements.

## Failure triage

Use the execution chain rather than guessing from the visible surface:

```text
speech transport
→ ASR final
→ canonical checkpoint
→ pending scheduler
→ interpretation request
→ provider response
→ normalization / validation
→ durable accepted event
→ reduced lesson state
→ learner render
```

If an earlier stage has no evidence, do not diagnose a later stage as the root cause.

Provider timeout, malformed output, validation rejection, persistence failure, and renderer visibility failure are different failure classes. The learner should retain the last accepted surface while these are investigated.

## Replay compatibility

Historical accepted event versions that the runtime promises to support must remain replayable. Do not rewrite old accepted events or run current proposal validation over historical accepted payloads merely to simplify migration.

The upcoming Core-domain migration should introduce a versioned event/state contract and preserve legacy replay intentionally.

## Documentation boundary

Product direction and learner-experience decisions are maintained outside the repository. Repository documentation owns only executable system contracts, trace behavior, operational procedures, and reproducible evaluation definitions.

Use:

- `docs/SYSTEM_CONTRACT.md` — executable system authority and migration target;
- `docs/TRACE.md` — diagnostic trace contract;
- `docs/EVALUATION.md` — evaluation definitions/compatibility;
- this file — operational procedures.

PR descriptions, spike reports, benchmark run reports, and historical notes are not authority documents.

## Controlled Core runtime (M3)

Normal `/session` remains on the legacy runtime. Core live orchestration is an explicit internal host API, with a Core interpreter supplied by the caller and the same closed canonical speech spans used by the existing checkpoint pipeline. It is exercised with deterministic injected transports; opening a Core runtime does not activate a provider or microphone.

Each stored session has one fixed semantic domain. A domain mismatch must fail restoration rather than convert events or start a second semantic authority. Core finalization must drain committed semantic evidence before ending the lesson; incomplete drains remain reloadable and retryable. Verification side work is best-effort and does not delay semantic finalization.

No learner compatibility projection or production Canvas renderer is part of this boundary. Production route selection and learner attention/rendering remain later migration work.

Use `openLessonRuntime(sessionId, { domain: "core" })` for a typed Core persistence owner, or `CoreLiveSession.open` for the complete scheduler/controller. `openLessonRuntime(sessionId)` defaults to legacy. Restoration must specify the same domain; an existing domain claim cannot be switched by changing URL parameters or inspecting later events.

An internal host supplies the session/speech-run identities, canonical closed spans and interpreter. In a browser the runtime defaults to local IndexedDB. A Node host supplies a `CoreEventStore` implementing atomic append/abort; deterministic tests use an injected store and transport. The provider bridge is `createCoreLiveInterpreter(model, transport)` from `server/teaching/core/live-interpreter.ts`; it uses the existing Core Structured Outputs envelope and parser, with no credential lookup. No production route imports or activates this bridge.

```ts
const live = await CoreLiveSession.open({
  lessonDomain: "core", sessionId, speechRunId, store,
  interpreter: createCoreLiveInterpreter(model, transport),
  trace: draft => traceWriter.emit(draft),
});
await live.commitClosedSpan(closedSpan, speechRunId);
// The host reads live.state / live.health and subscribes to live.runtime.
// First drain speech capture, then pass any final closed spans:
const ended = await live.finalize(finalClosedSpans, speechRunId);
// An incomplete drain remains retryable; do not mark the host lesson ended.
```

`contextOptions` supplies reviewed host scopes (`required`, `writable`, `factualBasis`) and any already trusted domain rules. The default retains the reviewed builder's current-Core append and grounded Parked-candidate capabilities. Choosing further mutation scopes is explicit host configuration; the controller does not infer authority from provider operations or verification leads. No automatic external evidence retrieval is configured.

Core scheduling retains the existing two-checkpoint maximum, approximate evidence budget and 8-second client deadline. The provider deadline is cleared before persistence. Transport/storage failures retry after 1 and 2 seconds and pause after three consecutive failures; channel conflicts retry immediately within the same failure limit. Schema/semantic/budget rejection pauses immediately. `NEEDS_CONTEXT` also pauses immediately: `resume()` reprojects its grounded query, while newly committed evidence remains queued behind the prefix. `cancel()` retains evidence and requires resume; changing a speech run cancels stale work and continues the ordered pending evidence with a fresh request identity.

Finalization uses a 12-second semantic drain deadline. A failed drain returns `false` without writing an end event. Reload restores pending checkpoints from durable replay. A historical Core log with both `lesson.ended` and pending evidence returns `core-ended-with-pending-evidence`; investigate that log without rewriting its evidence or treating it as successfully drained.

Verification defaults to an explicit unconfigured/drop sink. An injected sink receives session ID, Core request ID, original sidecar index, checkpoint IDs, query, claim and candidate evidence. The queue admits at most 32 outstanding jobs, runs one at a time on later task turns and times out after 6 seconds. Results cannot become accepted events or trusted rules. Finalization cancels outstanding jobs. Trace reports drop/pressure/failure/timeout/cancel/completion independently.

Deterministic M3 regression coverage runs with:

```sh
npm test -- src/lesson-stream/core/runtime.test.ts src/lesson-stream/core/live-session.test.ts src/lesson-stream/core/verification-dispatcher.test.ts src/lesson-stream/store-domain.test.ts src/trace/core-trace.test.ts
npm run eval:core:validate
npm run eval:core:validate -- --fresh-holdout
```

These commands make zero provider/verifier calls. Exemplar validation does not rescore historical model results or establish real microphone/learner acceptance.

## Teaching Representation development review

Run the ordinary development server and open the isolated review entry:

```sh
npm run dev -- --host 127.0.0.1 --port 5186 --strictPort
```

- Chemistry: `/dev/teaching-representation?lesson=chemistry`
- Mathematics: `/dev/teaching-representation?lesson=math`

Use **Next** for sequential replay, the checkpoint selector for a particular accepted snapshot, and **Review diagnostics** for the separate host inspection panel. It shows accepted references, producer candidates, host payloads, M4A selection, artifact identities/revisions/capability IDs, Semantic Space membership/bounds/placement, persistent and temporary rectangles, and camera state. Sequential replay is the continuity review path; jumping backward intentionally replays an earlier snapshot and can reconstruct artifact/space history.

**Grow selected artifact** changes measured UI width by 120px per click. The space allocator updates local bounds, moves colliding neighbors by the nearest permitted separating translation and propagates pressure locally. **Reset measured widths** shrinks content without compacting the world. Drag or wheel on the projector enters teacher inspection and holds automatic camera movement while accepted updates still revalidate content. **Follow teaching** reframes the latest accepted selection. Inspection cannot retain invalidated content as lesson truth.

The generic producer receives a detached frozen accepted snapshot and committed grounding. Admission returns lightweight candidates plus a host-side `payloads` map; the capability registry is a separate trusted implementation registry. The runtime joins M4A-selected IDs, checks their bindings, and revalidates retained artifacts before any reuse. Non-selected valid history remains hidden. Media switches use distinct visual identities over the same accepted reference; they do not create Core knowledge.

Semantic Space membership currently uses explicit accepted anchors plus caller-provided grouping keys. Members append in local order; measured growth moves only obstructed local members. Independently packed spaces use a deterministic bounded pressure wave. COMPARE/WIDEN coordinates remain a separate temporary overlay. Safe fixed-size travel uses the extracted measured motion planner; content resizing or an unsafe two-phase path settles atomically instead of animating through overlap. The automatic camera has a 0.65 zoom floor and reports insufficient fit in diagnostics; arbitrary dense layout and oversized content are not solved. Space/artifact persistence across reload or devices is not implemented.

This entry has no model, provider or verifier call path. Normal `/session` and the production browser bundle retain their existing entry and behavior. The review harness is not a production integration or M4C cutover.
