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

New sessions use `lesson-event-v5-core`. Existing v3/v4 sessions replay through their historical reducer generation; no events are translated or rewritten on read.

## Documentation boundary

Product direction and learner-experience decisions are maintained outside the repository. Repository documentation owns only executable system contracts, trace behavior, operational procedures, and reproducible evaluation definitions.

Use:

- `docs/SYSTEM_CONTRACT.md` — executable system authority and migration target;
- `docs/TRACE.md` — diagnostic trace contract;
- `docs/EVALUATION.md` — evaluation definitions/compatibility;
- this file — operational procedures.

PR descriptions, spike reports, benchmark run reports, and historical notes are not authority documents.

## Production session domain and Core runtime

Normal `/session` allocates an identity and calls `LocalLessonEventStore.resolveDomain` before mounting a semantic host. Newly allocated identities durably claim `core`, including empty sessions. A URL with an existing `sessionId` restores its stored claim. An unknown reopen identity fails with `lesson-domain-missing`; invalid claims and mismatched generations fail closed. Historical unclaimed v3/v4 logs retain the reviewed deterministic legacy detection and are claimed as legacy without changing event bytes. An unclaimed Core log is rejected. Query parameters cannot switch domains.

Each stored session has one fixed semantic domain. A domain mismatch must fail restoration rather than convert events or start a second semantic authority. Core finalization must drain committed semantic evidence before ending the lesson; incomplete drains remain reloadable and retryable. Verification side work is best-effort and does not delay semantic finalization.

The domain gate lazily loads `CoreSession` or `LegacySession`. The Core host calls `openCoreSession`, which composes the existing `CoreLiveSession` controller with the bounded HTTP adapter. Accepted publication drives `CoreTeachingSurface` through `PresentationStage`. Legacy restoration retains `useLiveTeaching`, `LessonStreamRuntime` and its legacy-compatible surface. No Core accepted state is converted into a Board snapshot. Trace completion cannot allocate a replacement lesson identity on reload; an ended Core lesson remains readable, and starting another lesson explicitly allocates a new identity.

Use `openLessonRuntime(sessionId, { domain: "core" })` for a typed Core persistence owner, or `CoreLiveSession.open` for the complete scheduler/controller. `openLessonRuntime(sessionId)` defaults to legacy. Restoration must specify the same domain; an existing domain claim cannot be switched by changing URL parameters or inspecting later events.

An internal host supplies the session/speech-run identities, canonical closed spans and interpreter. In a browser the runtime defaults to local IndexedDB. A Node host supplies a `CoreEventStore` implementing atomic append/abort; deterministic tests use an injected store and transport. The provider bridge is `createCoreLiveInterpreter(model, transport)` from `server/teaching/core/live-interpreter.ts`; it uses the existing Core Structured Outputs envelope and parser, with no credential lookup. Production uses `/api/teaching/core-interpretation`, backed by the same `coreProviderRequest` envelope and `interpretCore` parser. Only the bounded context crosses HTTP; full replay and reference maps remain local acceptance bindings. Server configuration uses the existing `OPENAI_API_KEY` and `OPENAI_MODEL` values. Missing configuration returns a non-accepting failure and retains pending evidence. The OpenAI SDK and credentials remain server-side. The legacy interpretation endpoint remains exclusively for legacy hosts.

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

`contextOptions` supplies reviewed host scopes (`required`, `writable`, `factualBasis`) and any already trusted domain rules. The default retains the reviewed builder's current-Core append and grounded Parked-candidate capabilities. The normal production host explicitly permits revisions of up to the existing optional-root budget of valid units in the current Core, plus the current Cue, using `writable`. The existing builder still owns structural closure, bounded admission and capabilities; the controller does not infer authority from provider operations or verification leads. Other historical targets retain the existing grounded candidate/refocus behavior. This conservative host scope does not expand correction authority or add domain rules. No automatic external evidence retrieval is configured.

Core scheduling retains the existing two-checkpoint maximum, approximate evidence budget and centralized deadlines (12-second provider/server, 14-second client). The provider deadline is cleared before persistence. Transport/storage failures retry after 1 and 2 seconds and pause after three consecutive failures; channel conflicts retry immediately within the same failure limit. Schema/semantic/budget rejection pauses immediately. `NEEDS_CONTEXT` also pauses immediately: `resume()` reprojects its grounded query, while newly committed evidence remains queued behind the prefix. `cancel()` retains evidence and requires resume; changing a speech run cancels stale work and continues the ordered pending evidence with a fresh request identity.

The first M6 owner dogfood found the former 6-second provider deadline too close to observed successful calls (about 4.10–5.42 seconds), with repeated aborts immediately before 6 seconds. Alpha now uses 12 seconds for the provider/server and 14 seconds for the client, preserving 2 seconds of transport grace so the server normally classifies termination first. This is a dogfood observation window, not the final latency target: future work must reduce actual latency rather than normalize 12-second learner latency. The shared centralized policy also supplies the historical legacy HTTP/client timing; verification and finalization deadlines remain independent and unchanged.

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

This authored review entry has no model, provider or verifier call path and remains outside the production bundle. Normal new `/session` sessions use Core; this authored entry remains separate from production acceptance. The separate Core-backed review below exercises the production shared-surface integration.

## Core shared-projector integration (M4C)

A controlled Core host passes `live.runtime` as `coreTeaching.source` to the existing `PresentationStage`, or mounts `CoreTeachingSurface` directly. The stage's props select exactly one Core or legacy surface. A Core surface subscribes to `CoreLessonStreamRuntime` publication and reads its accepted state plus committed checkpoints; it has no semantic reducer, event-store writer, interpreter or verification sink. Normal Core `/session` composition supplies `coreTeaching.source = live.runtime`. Only a stored legacy session supplies legacy `teachingState`. There is no URL switch for changing semantic domain.

The production composition root is `src/session/representation-composition.ts`. It registers only `accepted.content`, a deterministic literal rendering of accepted Object/Relation/Support/Cue text. It does not parse subject structure, execute generated markup, or register the finite Chemistry/Math development capabilities. New claims still require Core acceptance. Availability is bounded to 128 candidate targets: requested targets first, then valid current-Core units in stable identity order. Retained artifacts revalidate independently of this candidate pool. Exceeding this availability budget is not semantic deletion or a lesson capacity.

The host may supply a complete M4A projection; `attention.representations` (including an empty selection), `transition`, `projector` and `parkedCoreIds` pass through unchanged. Without completed representation selection, semantic target/role requests use the existing deterministic metadata selector. Without a host attention plan, the fallback focuses the last accepted added/revised Object in the current Core, retains a still-valid current target, or chooses the first valid current Object by stable identity. Current Cue is a separate companion/dominant accepted-text artifact. This is a conservative Alpha fallback, not a new autonomous Governor or subject coverage claim.

Production candidate/artifact/payload IDs use a versioned lossless tuple of session ID, reviewed producer ID, capability ID, medium, semantic reference and reviewed representation variant. Content, revision, array order, camera and DOM identity are absent. IDs are bounded at admission (16,384 characters) rather than hashed; oversized identities fail representation admission without changing Core. Runtime binding tombstones prevent candidate/artifact/payload identity reuse for another producer, capability, target or Space, including after withdrawal. These are in-memory representation identities; no Core ID or representation event log is added.

`assignSpace` owns Alpha membership in the projection layer. The conservative policy uses each valid accepted target as its anchor and the fixed `accepted-target-v1` grouping key. Multiple media for one target share that neighborhood; distinct units (even under the same Core) remain separate. Accepted relation endpoints alone do not establish a stable pedagogical grouping, so connected-component inference is deliberately absent. Revision and return reuse the target's Space. Canvas never receives subject-specific grouping logic or semantic-authored coordinates.

Canvas observes the surface and every mounted artifact with `ResizeObserver`, deduplicates unchanged dimensions, and settles measured pressure before the next paint. It measures on invalidation, never every animation frame. Invalid measurement/unresolved pressure hides the unsafe surface and reports a distinct visual failure; renderer exceptions are isolated per artifact and retry on a later accepted revision. Revalidation continues during shared-camera inspection and invalidated content withdraws. Follow teaching frames the current selection, while subsequent M4A instructions retain authority. Non-selected valid artifacts remain mounted but hidden. COMPARE/WIDEN temporarily wrap canonical artifacts into rows when needed for the viewport; persistent homes remain unchanged. Insufficient fit at the 0.65 automatic zoom floor is visible and diagnostic, with manual pan/zoom available.

For deterministic browser review, open `/dev/core-projector` on the normal development server. **Accept teaching** submits synthetic closed evidence through the actual Core scheduler, validator and IndexedDB persistence using an injected local interpreter. **Revise content**, **New mainline**, **Return mainline** and **Withdraw first** perform subsequent accepted semantic transactions. **Focus**, **Compare** and **Widen** supply explicit transient attention plans; drag/wheel and **Follow teaching** operate the production shared camera. The diagnostics disclosure records accepted state, representation/lifecycle trace and measured Canvas geometry. This dev-only entry has no model/provider/verifier or microphone path; it does not load authored GOLD snapshots. Capture review evidence only under ignored `.cuelayer/reviews/`.

## Normal-route cutover validation

`src/session/production-session.test.tsx` mounts the actual normal session entrypoint with synthetic speech transport, the real Core HTTP client/scheduler/validator and local IndexedDB. It checks durable domain selection, canonical speech ingress, no legacy runtime or dual-write, delayed/failed persistence before DOM publication, provider rejection, stable revision identity, renderer recovery, exact reload without another interpretation call, completed-trace isolation, finalization and legacy routing. `session-domain.test.ts` covers missing/invalid/mismatched claims and historical v3/v4 combinations; `core-session.test.ts` covers side failures, stale acceptance and incomplete finalization through the production composition.

```sh
npm run typecheck
npm test
npm run build
npm run eval:semantics:validate
npm run eval:core:validate
npm run check:repo -- --clean
git diff --check
npm run report:bundle
```

The bundle command builds the actual production graph without writing build output and reports module IDs/counts, per-chunk raw/gzip/brotli bytes and the initial static load. Compression uses Node's built-in zlib. Baseline PR31 (`8f54e9b428835b808b810eb09142897ad18459bf`) is 122 modules, 446,635 raw, 130,930 gzip and 112,302 brotli bytes. Compare combined emitted chunks consistently; compression totals sum separately compressed chunks. Use `-- --root PATH` to measure another checkout. Core controller/client code is lazy-loaded after the stored Core domain resolves; legacy controller code loads only for legacy restoration.

Browser review must use `/session` with local injected interpretation, synthetic committed speech and real IndexedDB persistence. Instrumentation/transport overrides may be supplied by an ignored review-server plugin; do not add a production URL domain toggle or import development fixtures into the application. Test desktop 1280×720, narrow 390×844 and reduced motion; hold persistence, revise accepted content, shift/refocus mainlines, inspect/follow, fail/recover representation, reopen and finalize pending evidence. Also restore a reviewed historical v3/v4 fixture. Check settled geometry, visible artifact identities, console and requests. Record evidence only in ignored `.cuelayer/reviews/m5/`. No microphone, external model/verifier call or new model evaluation is part of this gate. The existing zoom floor and limited accepted-content fallback remain unchanged.
