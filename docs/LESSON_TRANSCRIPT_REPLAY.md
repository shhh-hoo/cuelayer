# Real-lesson transcript replay harness

**Delivery: REPLAY_HARNESS_READY. This is not LIVE_SEMANTICS_PASS.**

## Baseline and scope audit

At task start, local and GitHub PR #15 head were both `c180a87e588a2797af17d51c4bf23a4d2842f190`, branch `feat/alpha-teaching-semantics`, with a clean working tree. PR #15 was open and Draft. `docs/CONTINUOUS_STATE_REPAIR.md` describes the implemented baseline, not work to redo. This harness does not change Board/Cue semantics, profile, policy, normalization rules, validator, reducer, model selection, deadlines, retry policy or frozen benchmark history. No microphone, TTS, video playback or configured provider was used for this delivery.

Production path inspected:

1. Speechmatics final → `src/session/canonical-speech.ts` and canonical-span lifecycle in `use-canonical-speech-span-lifecycle.ts`.
2. Closed canonical span → `LessonStreamRuntime.commitClosedSpan` → `checkpointFromClosedSpan` in `src/lesson-stream/evidence-checkpoints.ts` → durable checkpoint event.
3. `use-live-teaching.ts` drives `LosslessInterpretationScheduler` and `RetryBackoff`.
4. `context-projection.ts` builds the P4 request from processed events, current state and the scheduled new-evidence prefix.
5. Browser HTTP interpreter → `api/teaching/interpretation.ts` (or the Vite development middleware) → `requestOpenAITeachingInterpretation` → current structured-output schema → `normalizeTeachingProposal`.
6. `LessonStreamRuntime.acceptProposal` → `validateAndNormalizeProposal` → accepted lesson events → production reducer → Teaching State.
7. Browser `TeachingSurfaceLayer` renders state. NOTE expiry originates in the browser Cue component.

The only browser-path extraction is `nextTeachingRequest` in `src/lesson-stream/scheduled-request.ts`: the existing batching and full-context budget calculation was moved unchanged and is now called by both the hook and CLI. Existing actual-hook regressions verify production behavior after extraction. The CLI drives the production scheduler, backoff, abort wrapper, request builder and lesson runtime; it does not define a second scheduler, validator, reducer or semantic prompt.

## Injection boundary and coverage

**Closed-canonical-span replay through the production checkpoint builder.** JSONL segments become explicitly preclosed spans with no fabricated word timings. `commitClosedSpan` calls the real checkpoint builder, including its whitespace normalization and non-lexical filtering. This is not prebuilt-checkpoint replay, but it does bypass microphone, ASR and production canonical segmentation. A segment boundary is supplied by the transcript/diagnostic strategy, not discovered from audio. `explicit_stop` is the adapter's closure marker, not a claim that the teacher stopped.

Mock supplies a mechanical text echo through the current provider schema and normalizer. It is not a teaching-quality oracle. Its simulated server deadline uses the production deadline constant. Configured mode calls the actual production API handler in-process, including its provider, normalization and six-second server timer; the production abort wrapper and eight-second client bound protect each CLI attempt. It bypasses browser HTTP transport. Therefore request-to-accept timing is CLI/provider timing, never microphone-to-DOM latency.

## Input v1: manifest plus JSONL

First version accepts local JSONL only. No real source/subtitle format was supplied during implementation; native subtitle import can be added for the first actual material without building a website downloader. Keep source files in `.cuelayer/lesson-replay-inputs/` (already gitignored). Retain the original file; the tool only reads it. If you convert native captions to raw JSONL, also retain the original native file alongside it and document that conversion in the normalization rules/source metadata before evaluation.

Use `resources/lesson-replay/synthetic/manifest.json` as the complete manifest example. It records lesson ID, title/URL, language, playback interval, media timeline origin, transcript type, raw/normalized byte hashes, normalization rules, timestamp precision, availability rule and visual-input status. Transcript types distinguish human subtitles, automatic subtitles, ASR output, human-corrected text and synthetic fixtures. Raw and normalized files are independently hash-checked; original IDs must exist in raw JSONL. Do not relabel corrected material as unedited subtitles.

Raw JSONL rows require `segmentId` and `text` and may preserve source metadata. Normalized rows use:

```json
{"segmentId":"s1","startMs":10000,"endMs":12000,"availableAtMs":12000,"text":"The original words, including repetition.","originalSegmentIds":["raw-1"]}
```

All source times are milliseconds on the same media timeline, within the declared playback interval. `timelineOriginMs` sets zero for realtime delivery; it is not a Unix timestamp. `availableAtMs` defaults to `endMs`. Availability before the segment end is rejected in v1 because no word-time delivery is implemented. Input must already be ordered by availability; it is not silently sorted or rewritten. Visual input must be false because the current product does not supply video frames to interpretation.

The tool does not correct subject matter, finish sentences, remove repeated words or add classroom instructions. The production checkpoint builder collapses whitespace; this existing behavior is recorded in the run's injection rules. Source bytes remain untouched.

Optional `--split sentence` partitions within each supplied segment at punctuation; it does not merge text from future subtitles. `--split phrase` deliberately cuts at 12 Unicode characters, including inside words. Both preserve the exact concatenated source text and original IDs. Derived interval endpoints use character proportions and are **synthetic**; every piece retains the parent's availability time. `original` is the default. These strategies diagnose segmentation sensitivity, not actual acoustic timestamps.

## Commands

From the repository root:

```sh
npm run eval:lesson-replay -- --input resources/lesson-replay/synthetic/manifest.json --mode sequential --out .cuelayer/lesson-replay/mock-sequential
npm run eval:lesson-replay -- --input resources/lesson-replay/synthetic/manifest.json --mode realtime --mock-delay-ms 180 --out .cuelayer/lesson-replay/mock-realtime
npm run eval:lesson-replay -- --input resources/lesson-replay/synthetic/manifest.json --mode realtime --mock-plan resources/lesson-replay/synthetic/failure-plan.json --out .cuelayer/lesson-replay/mock-recovery
npm run eval:lesson-replay -- --input resources/lesson-replay/synthetic/manifest.json --mode sequential --split phrase --out .cuelayer/lesson-replay/mock-phrases
npm run eval:lesson-replay -- --replay-events .cuelayer/lesson-replay/mock-realtime/lesson-events.jsonl --out .cuelayer/lesson-replay/restored
```

Output directories must not already exist. Omitting `--out` creates a unique gitignored local directory. The default is mock, 100 attempts and ten minutes. `--max-attempts` counts all requests, including failed attempts; `--max-runtime-ms` bounds input delivery and recovery. Ctrl-C/SIGTERM writes a partial report. Exit code 0 means completed, 2 means paused/cancelled/budget-limited with preserved evidence, and 1 means an input/configuration/tool error.

Sequential waits for work and bounded recovery before delivering the next segment; if recovery pauses, undelivered input is reported separately. It cannot prove realtime throughput. Realtime uses monotonic wall-clock time at 1x and continues delivering due input while a request is in flight, including while automatic recovery is paused. No input is passed to the interpreter until delivered and scheduled. No full-lesson prompt, expected Board timeline, reference answer or visual description is included.

Configured mode is implemented but **was not invoked in this task**. It requires all of `--provider configured --allow-configured --max-attempts N --max-runtime-ms N` and `OPENAI_API_KEY` in the environment. It uses the API's existing `OPENAI_MODEL` selection/default and current contract. No `.env` files are automatically loaded and there is no deadline/model/policy override option. Never put a credential on the command line. A future explicitly authorized invocation can use:

```sh
npm run eval:lesson-replay -- --input .cuelayer/lesson-replay-inputs/lesson/manifest.json --mode realtime --provider configured --allow-configured --max-attempts 20 --max-runtime-ms 180000 --out .cuelayer/lesson-replay/lesson-configured
```

## Evidence files

Each run writes `run-manifest.json` (commit/dirty state, input and normalization hashes, split algorithm/hash, times, provider settings and policy/profile/schema digests), `timeline.jsonl`, `lesson-events.jsonl`, `result.json` and `report.md`. The separate event-replay command writes a manifest, restored state and report and makes zero provider calls.

The timeline records media source interval, evidence availability, actual arrival/run time, request/attempt, output or error, before/delta/after, consumed IDs, pending count and oldest pending age. Failed attempts and withheld input are retained; unprocessed input is never converted to KEEP. Source IDs and segment metadata remain outside the provider request except canonical checkpoint provenance. The production `sanitizeAuditValue` and `canonicalJson` serialization retain complete safe audit DTOs and redact credentials. This timeline has its own `lesson-replay-timeline-v1` schema; it is not mislabeled as a browser session trace or render event. Large outputs and real transcripts stay local by default. Do not commit them.

`report.md` gives the state/failure timeline and unverified scope. It produces no teaching accuracy percentage or quality score. Mock reports establish engineering behavior only. Saved event replay demonstrates deterministic restoration of accepted state, not semantic correctness.

## Observations and defects not repaired

- The baseline's six-second provider limit and continuous-live backlog failures remain documented in `CONTINUOUS_STATE_REPAIR.md`; no real provider was called to re-evaluate them here.
- P4 retains processed history. Once the production full-context budget no longer fits even one checkpoint, the harness reports a budget pause with pending evidence preserved. No truncation, context policy change or budget increase is introduced.
- NOTE expiration depends on a browser component timer. The CLI records this coverage gap rather than inventing a replacement timer or claiming DOM lifecycle coverage. A future shared non-DOM expiry orchestration would need a separate reviewed change.
- A configured invocation bypasses browser HTTP transport, IndexedDB and React session/run replacement. Their regressions remain separate; this harness does not claim browser timing or visual acceptance.
- There is no real-material finding yet: only explicitly marked synthetic fixtures were used. Teacher-run video sessions and exported traces remain the user's responsibility.

## Offline verification for this delivery

- Typecheck, all **204 tests across 39 files**, build, frozen semantics validation and diff whitespace checks passed.
- **19 new harness tests** cover delivery order, exactly-once consumption, future-context exclusion, realtime input during delayed responses, pinned retries, provider failure/timeout, cancellation and both run budgets, validation pauses, replay without model calls, distinct clocks, lossless split provenance and credential redaction/configured opt-in guards. Existing nine actual-hook regressions passed after the shared request extraction.
- A wall-clock mock CLI recovery run delivered all three segments while the first attempt was outstanding, recorded the injected failure, then recovered all three checkpoints with no duplicates or remaining pending. The sample is synthetic and not evidence of LLM understanding.
- Frozen v5 validation retained 60 cases (40 development / 20 holdout), SHA-256 `107d2315cf4f64c42256955c05f24e6a7c15508a30def82039c69fcf9e43355c`. All 163 historical semantics files remained byte-identical. No new matched benchmark was created.
