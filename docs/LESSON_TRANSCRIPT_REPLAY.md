# Real-lesson transcript replay harness

**Delivery: REPLAY_HARNESS_READY. This is not LIVE_SEMANTICS_PASS.**

## Production reuse

The CLI shares `nextTeachingRequest`, `LosslessInterpretationScheduler`, retry/abort handling, context projection, provider normalization, validation and LessonStreamRuntime with the browser. The current dataflow and semantics are defined in [System Spec](LIVE_TEACHING_SYSTEM_SPEC.md).

## Injection boundary and coverage

**Closed-canonical-span replay through the production checkpoint builder.** JSONL segments become explicitly preclosed spans with no fabricated word timings. `commitClosedSpan` calls the real checkpoint builder, including its whitespace normalization and non-lexical filtering. This is not prebuilt-checkpoint replay, but it does bypass microphone, ASR and production canonical segmentation. A segment boundary is supplied by the transcript/diagnostic strategy, not discovered from audio. `explicit_stop` is the adapter's closure marker, not a claim that the teacher stopped.

Mock supplies a mechanical text echo through the current provider schema and normalizer. It is not a teaching-quality oracle. Its simulated server deadline uses the production deadline constant. Configured mode calls the actual production API handler in-process, including its provider, normalization and six-second server timer; the production abort wrapper and eight-second client bound protect each CLI attempt. It bypasses browser HTTP transport. Therefore request-to-accept timing is CLI/provider timing, never microphone-to-DOM latency.

## Input v1: manifest plus JSONL

First version accepts local JSONL only. Keep source files in `.cuelayer/lesson-replay-inputs/` (already gitignored). Retain the original file; the tool only reads it. If you convert native captions to raw JSONL, also retain the original native file alongside it and document that conversion in the normalization rules/source metadata before evaluation.

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

Configured mode requires explicit provider authorization. It requires all of `--provider configured --allow-configured --max-attempts N --max-runtime-ms N` and `OPENAI_API_KEY` in the environment. It uses the API's existing `OPENAI_MODEL` selection/default and current contract. No `.env` files are automatically loaded and there is no deadline/model/policy override option. Never put a credential on the command line. A future explicitly authorized invocation can use:

```sh
npm run eval:lesson-replay -- --input .cuelayer/lesson-replay-inputs/lesson/manifest.json --mode realtime --provider configured --allow-configured --max-attempts 20 --max-runtime-ms 180000 --out .cuelayer/lesson-replay/lesson-configured
```

## Evidence files

Each run writes `run-manifest.json` (commit/dirty state, input and normalization hashes, split algorithm/hash, times, provider settings and policy/profile/schema digests), `timeline.jsonl`, `lesson-events.jsonl`, `result.json` and `report.md`. The separate event-replay command writes a manifest, restored state and report and makes zero provider calls.

The timeline records media source interval, evidence availability, actual arrival/run time, request/attempt, output or error, before/delta/after, consumed IDs, pending count and oldest pending age. Failed attempts and withheld input are retained; unprocessed input is never converted to KEEP. Source IDs and segment metadata remain outside the provider request except canonical checkpoint provenance. The production `sanitizeAuditValue` and `canonicalJson` serialization retain complete safe audit DTOs and redact credentials. This timeline has its own `lesson-replay-timeline-v1` schema; it is not mislabeled as a browser session trace or render event. Large outputs and real transcripts stay local by default. Do not commit them.

`report.md` gives the state/failure timeline and unverified scope. It produces no teaching accuracy percentage or quality score. Mock reports establish engineering behavior only. Saved event replay demonstrates deterministic restoration of accepted state, not semantic correctness.

## Coverage limits

- NOTE expiration depends on the browser component timer. The CLI does not simulate expiry; an expired-but-present NOTE may affect later currentState and interpretation.
- Configured replay bypasses ASR, production canonical segmentation, HTTP transport, IndexedDB, DOM and browser NOTE expiry. It does reuse the production closed-span checkpoint builder.
- The current bounded history policy can block on missing/oversized mandatory dependencies; pending is retained. Six-second provider and eight-second client deadlines remain in both modes.
- Real lesson input, raw captions, review anchors and run outputs stay local. Never send future captions, gold, expected Board timelines or unavailable visual descriptions as context.

## Controlled manual MIT diagnostic playback

Use the same [MIT Lecture 34 source](https://ocw.mit.edu/courses/5-111sc-principles-of-chemical-science-fall-2014/resources/lecture-34-kinetics-catalysts/), **04:30.950–08:47.570**, once at 1x. The existing local input is `.cuelayer/transcript-baseline/2026-09-06-mit-catalysts/manifest.json`. The subtitle track's human/automatic origin is unverified; the manifest records its enum compatibility mapping rather than claiming manual correction.

1. Start the updated local app with the existing secure server environment (`npm run dev`), then open its local `/session?debug=speech`. Record git commit, browser/OS, presentation mode and audio route; keep production model, deadlines and recovery settings.
2. Create a fresh session. The user enables the existing microphone path and manually plays the clip. Keep CueLayer foreground and visible, and record focus changes. Presentation capture requests `audio: false`; this is not tab/system audio support. Speaker → microphone playback includes device and room effects. No TTS, driver installation or user lecturing is required.
3. Stop at the endpoint, use the normal stop/drain flow and retain failures/pending if drainage pauses. Record NOTE creation and expiresAt if present. Do not increase deadlines or repeatedly rerun to obtain success.
4. Expand **Persistent trace**, select the session, **Reload trace**, then **Export JSONL**. Preserve the unmodified export and playback notes under `.cuelayer/live-evidence/`. No historical/private trace is resent automatically.
5. Join checkpoint/request/accepted-state/render observations using [the trace field and clock contract](TRACE_ARCHITECTURE_V2.md). Include unavailable counts, timeout/pending cohorts and gaps; never turn missing values into zero or KEEP. This is diagnostic latency measurement, not a LIVE PASS gate.

This procedure does not itself authorize a paid run or allocate a new budget. Transcript and microphone results have different coverage; the [baseline](SEMANTICS_BASELINE.md) records current unresolved findings.
