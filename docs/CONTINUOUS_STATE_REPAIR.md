# Continuous Teaching State repair — September 6

Status: deterministic repair implemented; **CONTINUOUS_LIVE_PASS = false**. Keep PR #15 open, Draft and unmerged. The new state contract is not certified by the historical v5 acceptance.

## Audit before behavior changes

- contracts.ts: no Board retirement, atomic Cue replacement, or subordinate hint in deltas/snapshot.
- provider-contract.ts: newEvidence-only enum reused for consumption and provenance prevents historical fragment reconstruction, even though normalizer and P4 carry historical text.
- accepted-interpretations.ts: searches all lesson checkpoints, admits future refs, compares model revisions directly to current state, and conflict salvage consumes fabricated KEEP. SET HINT over TASK is rejected.
- teaching-state.ts: no retire; global Support slice(-2) requires truth-critical qualifiers to live in primary content; owner pruning needs to be deterministic.
- context-projection.ts: full processed evidence/journal preserved, but projected cost omits policy/schema; historical revision projection misses NOTE expiry events.
- TeachingSurfaceLayer.tsx: all Support renders beside Active regardless of target; retained-only Board returns null.
- pending-evidence.ts and retry-backoff.ts: ordered one-flight foundation is correct; retries grow with pending arrivals, budget only new text, no checkpoint/attempt ceiling; restore leaves old flight.
- use-live-teaching.ts: rejection trace uses request revisions; catch/finally, timers and queued commits lack complete generation guards.
- API/Vite/browser race at 6000ms; Vite omits failure audit; SDK default retries not disabled.
- runtime.ts: close does not invalidate work; serialized acceptance still needs snapshot conflict and generation checks.

September 5 Chrome: 14 accepted requests, two HINT-over-TASK rejections, then 16 timeouts at 6002–6007ms; 51 checkpoints = 15 consumed + 36 pending. Definition fragments were consumed unfinished; catalyst and sketch TASK remained. Firefox ASR distortion also reproduced before PR15, so audio architecture stays unchanged. Raw traces remain local; historical report unchanged. System spec v0.6 section 0.1 is updated before implementation.

## Deterministic verification

The new tests exercise final rendered meaning, canonical one/two/three-fragment provenance, retirement retain/discard, Support ownership, qualifier survival, primary TASK/QUESTION plus hint, atomic replacement, QUESTION/context/answer, future-evidence rejection, conflict preservation/recovery, capped retries and real React hook session/run replacement. They also cover recovery while the microphone is muted and immediate pauses for parsing, normalization and budget failures. `jsdom` is a test-only dependency for actual hook effects; no production dependency was added. Final command results are recorded below.

Frozen-history verification: all 163 existing files under resources/semantics remain byte-identical. Corpus v5 SHA-256 remains 107d2315cf4f64c42256955c05f24e6a7c15508a30def82039c69fcf9e43355c. Recomputed v7 core/augment policy digests and base provider schemas still match their historical identities. Historical v3 events explicitly dispatch to the preserved v3 reducer, while new operations append v4 events; no historical event is rewritten.

New continuous live acceptance uses the fixed 241-word script at 150 words/minute without added eight-second sentence pauses. Chrome browser preflight passed. Microphone permission was initially blocked by automatic review; the user subsequently explicitly authorized physical-microphone tests in Chrome and Firefox and transmission to Speechmatics/OpenAI. A separately proposed resend of old Chrome request 17 remains pending separate authorization.

## First continuous microphone result (pre-stable schema)

Chrome session `session-80770a89-4452-4b8f-a23a-9e921980486d`: 21 requests, 12 accepted, nine audited server timeouts; 16 accepted steps. All requests contained at most two new checkpoints. Three timeout pairs recovered automatically; the final three failures paused deterministically. 50 committed checkpoints = 21 uniquely consumed + 29 preserved pending. No duplicate consumption. Definition reconstruction, same-topic focus shift, Board retirement, TASK + subordinate HINT, task completion and QUESTION establishment all occurred. Subsequent answer/AUGMENT/correction/topic-shift work did not finish. Normal-route reload restored Board r6/Cue r6. Capture continued beyond the scripted playback and includes unrelated ambient ASR; raw evidence remains local.

The recorded accepted-request median was 5265.5ms and maximum 5952ms. Request-specific schemas remained a possible source of repeated setup latency, so v8.1 uses a stable provider schema while exact request membership is enforced by validation. This is a runtime hypothesis under live verification, not a benchmark-score optimization. A separate final-code run uses the same fixed script.

Microphone mute no longer stops processing already-committed pending evidence while the lesson remains active, allowing recovery without capturing additional speech. Session pause still pauses scheduling. The actual-hook regression covers this distinction.

## Implemented contract and identities

System spec v0.6 section 0.1 explicitly supersedes conflicting v0.5 execution rules. The live profile is `alpha-continuous-p4-v8`, policy `bounded-agent-p4-continuous-v8`, provider response format `teaching_interpretation_v8_1`, and new lesson event schema `lesson-event-v4-continuous`. The stable schema carries bounded string IDs; deterministic validation enforces their exact membership, order and canonical text. Historical v7 policies and schemas retain their old identities and bytes.

- **Evidence:** consumption covers ordered unconsumed new evidence exactly once. Current-step evidence triggers changes. Supplied P4 history plus current evidence can support a contribution, but future batch checkpoints and unsupplied lesson IDs cannot. Historical evidence is never consumed again.
- **Board:** `RETIRE_ACTIVE` targets the actual Active, requires current evidence, and uses `retain` or `discard` with `teacher_moved_on`, `completed` or `no_longer_current`. Retain places the item first among at most two Retained items. Support survives only with its owner and renders under that owner, including a retained-only Board. At most two optional Support items remain globally. Truth-critical qualifiers belong in primary content. No Board TTL exists.
- **Cue:** `ATTACH_HINT` adds one teacher-provided subordinate hint to TASK/QUESTION while preserving primary identity and activation. `REPLACE_CURRENT` grounds resolution and a new teacher-originated Cue in current evidence, atomically with one revision. Resolve/replacement clears the hint. Ordinary SET still cannot overwrite an unresolved TASK/QUESTION. Standalone HINT remains supported. Cue AUGMENT and autonomous CORRECT/INITIATE remain disabled.
- **Conflicts:** the model's revisions must match the request, then the request must match actual state. Any unsafe conflict rejects the entire request without consuming evidence. Retry rebuilds from authoritative state. Rejection traces use actual validation revisions.
- **Recovery:** one request in flight, at most two checkpoints per request, pinned failed prefixes, full projected context plus policy/schema and 2048 output-token reserve, and an exact provider-envelope guard. Oversized requests pause without dropping history. Provider/network/timeout failures allow two automatic retries; validation and budget failures pause immediately; conflict rebuilds are bounded; stale cancellations are inert. Explicit resume preserves pending evidence.
- **Deadlines and health:** server owns six seconds, browser adds two seconds for transport/audit, SDK retries are disabled. A development-only 6–60-second diagnostic setting changes both coherently; production has not been increased without a completed diagnostic. Pending count, oldest age, failures and in-flight age drive teacher health controls, never learner Board content. Generation guards and abortable persistence protect session/run replacement and close.

## Stable-schema Chrome result

Session `session-39865c06-b661-4612-a102-1327d736fed1` used the same continuous script and physical microphone, on the normal `/session` route. One explicit resume was performed with the microphone muted after automatic recovery paused. Production deadlines remained 6000ms server / 8000ms browser.

20 requests produced 12 accepted requests and eight audited server timeouts; 18 steps consumed 19 unique checkpoints. All 38 committed checkpoints are accounted for: 19 consumed, 19 pending, zero duplicate consumption. Requests never exceeded two new checkpoints. The schema digest was identical across all 20 attempts. Accepted latency median was 4991ms, maximum 5794ms. The schema change did not establish adequate throughput.

Board established, deepened, changed focal object and retired. TASKs resolved and a QUESTION appeared. This run did not attach a hint; the first run did. Neither run completed all later answer/AUGMENT/correction/topic-shift gates. Atomic replacement and cross-request fragment provenance are established by deterministic tests, not certified by this live run. Naturally occurring recoverable timeouts exercised recovery; no separate injected live failure was performed.

All 18 accepted transitions replay exactly under the reducer. Accepted references are canonical, supplied and not future evidence; this run used no historical contribution references. Normal reload restored Board r6 / Cue r5 and the entire final accepted state, with zero subsequent provider requests. The earlier run's 16 accepted transitions also replay exactly. This proves replay for recorded accepted states, not completion of the missing full live lifecycle.

Aggregate evidence and fixed-script provenance are in `resources/continuous-state-v8/`. Raw microphone traces remain local because capture includes ambient ASR beyond the scripted playback. They are not committed or uploaded.

## Firefox result and remaining trial blockers

Firefox was checked separately after Chrome released microphone capture. On both `127.0.0.1:4180` and a fresh `localhost:4180` origin, the page loaded but Enable mic did not begin capture. Native accessibility, pointer and keyboard activation were attempted. The browser console recorded `Script terminated by timeout` in React's `commitRootWhenReady` / scheduler path. No Firefox microphone permission prompt or Speechmatics capture began. Reload did not resolve the control failure. This is a pre-capture browser/runtime block, **not an ASR-quality result**; its cause is not isolated. No audio architecture was changed.

Before a small teacher trial: complete one authorized full provider diagnostic and choose viable deadline/throughput behavior; drain a continuous lesson without sustained backlog; complete all missing live Cue/answer/AUGMENT/correction/topic-shift gates and a controlled failure; isolate Firefox's startup/control failure and then perform its acoustic acceptance. A separate resend of September 5 request 17 remains unperformed because its disclosure authorization is still pending. The later approval covers the new live microphone tests only.

## Final verification

- `npm ci --cache /tmp/cuelayer-npm-cache`: passed (the first restricted-network attempt stalled; the registry-enabled rerun completed).
- `npm run typecheck`: passed.
- `npm test`: **185/185 passed**, 38 files.
- `npm run build`: passed.
- `npm run eval:semantics:validate`: passed, 60 cases / 40 development / 20 holdout, frozen hash unchanged.
- `npm run test:live-state`: **27/27 passed**, including 18 domain/rendering regressions and nine actual-hook cases.
- `git diff --check`: passed.
- All 163 pre-existing files under `resources/semantics/` match their pre-edit hashes. No new locked benchmark run was made.
- Initial Chrome local-page smoke rendered successfully without browser errors. The live reload retained the actual accepted Board/Cue. Teacher health says “behind” even when reload has left scheduling idle, avoiding a false progress claim.

The new microphone evidence was gathered before the final server failure-category mapping and health-label wording cleanup. Those final changes affect error classification/wording only; no further acoustic run is claimed after them.
