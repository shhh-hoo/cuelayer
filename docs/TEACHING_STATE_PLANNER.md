# Semantic Caption Planner

CueLayer remains a semantic subtitle product. This slice lets a short moment of committed teacher speech become a temporary caption using the existing renderer, while keeping the presentation primary.

```text
recent committed canonical speech
          ↓
compact 9701-derived live policy + one provider-neutral semantic planner call
          ↓
grounding validation
          ↓
deterministic CaptionClip + EffectCue compiler
          ↓
temporary semantic subtitle → automatic expiry
                       ↘ Space → one locked subtitle
```

## Small runtime contract

The runtime holds at most one transient `CaptionEpisode`, one locked episode, and one short learner cue. An episode is a renderer `CaptionClip`, optional existing `EffectCue`, status, source segment IDs, and expiry metadata. The learner cue is separate so `QUIET + NOTE` or `QUIET + REFLECT` can be useful without fabricating a caption. The canonical speech history remains the historical source of truth; CueLayer does not maintain semantic units, topics, state updates, correction records, graph structures, or a lesson memory.

The planner sees a six-segment bounded committed-speech window plus lightweight context for the active and locked captions. In one structured response it returns only the current grounded decision:

- display intent: `QUIET | TEXT | FOCUS | RELATE | TRANSFORM`
- learner intent: `NONE | NOTE | REFLECT`

The response may include only evidence needed for that decision: atomic protected spans, authorized FX-only symbolic rewrites, or scoped warnings. Speechmatics `segmentId` and exact text remain the provenance. The live call does not regenerate canonical text or request Chemistry-token, render-hint, or per-segment CueCaption dossiers. `QUIET` deliberately leaves the current visible caption unchanged and must state why; an independent learner cue can still appear. `TEXT` is exactly `{ kind: "TEXT" }`: the runtime renders the complete current canonical planner-work span without model-generated surface text. `TRANSFORM` requires explicit same-object/state-change language; causal wording is rejected. No decision may contain colours, treatment, timing, layout, animation, CSS, learner prose, or state updates.

The authoritative policy remains `skills/9701-cuecaption/SKILL.md`, its references, data, and evaluation suite. `skills/9701-cuecaption/live-policy.md` is the explicit reviewed runtime operational subset; arbitrary edits to the full skill are not automatically semantically distilled into the live prompt. `scripts/generate-cuecaption-policy.ts` deterministically consumes that file and the rewrite tables to produce compact runtime artifacts. Generated files carry a source SHA-256, and normal development, typecheck, test, and build commands fail if they drift. The product-level learner grammar also includes `REVIEW`; this PR intentionally implements only `NONE | NOTE | REFLECT` and does not redefine the charter-level grammar.

## Compiler and lifecycle

CueLayer validates referenced text and decision-specific evidence against the bounded canonical window, keeps protected phrases atomic, and strips unauthorized symbolic rewrites. Invalid `RELATE`, `TRANSFORM`, or `FOCUS` structures degrade deterministically to the useful current-span `TEXT`, never an inferred `FOCUS`; malformed `TEXT` becomes `QUIET` only when no current canonical span exists. Provider/parse failures use only known committed speech for `TEXT` or `QUIET`. An authorized rewrite matching the selected grounded target becomes `CueTarget.displayText`; target word IDs still come exclusively from Speechmatics timing. Its deterministic compiler selects only existing renderer treatments:

- `FOCUS` → `marker`
- `RELATE / cause` → `chain`
- `RELATE / sequence` → `ordered-steps`
- `RELATE / contrast` → `split-contrast`
- `TRANSFORM` → `state-change`

Transient episodes hold for five seconds; learner cues hold briefly on their own. Pressing Space locks the current episode without pausing teaching; pressing Space again when there is no current episode unlocks the one kept caption. Locking a newer current caption replaces the older locked caption. Space is an Alpha shortcut that still needs real presentation-workflow dogfooding. The actual session respects the browser reduced-motion preference. There are no editing, dragging, layout, canvas, or history controls.

## Planner transport and concurrency

CueLayer's live planner uses OpenAI Responses with `responses.parse` and `zodTextFormat`, defaulting to `gpt-5.6-luna`. CueLayer still applies deterministic product validation after structured parsing, because schema shape alone cannot prove speech grounding or whether an operation is semantically allowed.

Committed Speechmatics segments enter a tiny single-flight scheduler. One planner request runs at a time; finals arriving while it runs accumulate. Each planner window can look backward from the last dequeued segment, but cannot include later still-pending speech. The single 2.5-second live budget aborts timed-out work; when newer work is waiting after that budget, it aborts the obsolete request and schedules the newest closed/latest revision. Aborted work is traced and cannot compile or replace the learner-visible caption. This keeps short cross-turn moments possible without concurrent request races, duplicate semantic handling, or a generic workflow system.

Planner failure does not affect presentation transport or speech grounding. It emits a deterministic grounded fallback rather than leaving the semantic pipeline in an error state, and later committed speech remains eligible for planning. Continuous committed/provisional transcript inspection and planner details are absent from normal `/session`, including local development. They appear only through the explicit `/session?debug=speech` diagnostic route.

## Provider contract screen

`npm run benchmark:planner -- --output=artifacts/planner-benchmark.json` runs OpenAI once for each of 50 representative committed-speech cases, then passes every parsed response through the real runtime validator, deterministic degradation, and caption compiler. It reports structured-parse success, runtime-validation success, degradation kind, raw and effective intents, non-QUIET compile success, effective-intent accuracy, QUIET rate, and provider round-trip p50/p95. It exits non-zero for malformed output, unexpected runtime degradation, any non-QUIET compile failure, or less than 95% effective display-category accuracy; it intentionally has no retry or JSON-repair layer. Only the real browser microphone trace may report committed/final-to-planner and committed/final-to-render p50/p95.

## Development trace

Local `/session?debug=speech` also keeps a bounded 160-event in-memory trace for the current page lifetime. It follows existing committed segment IDs, planner request IDs, and caption episode IDs across `asr`, `commit`, `planner_gate`, `planner`, `compile`, and `render`. Negative outcomes are first-class events: partial speech has no commit, rejected finals carry a reason, queued planner work records a gate skip before its later run, intentional `QUIET` compiles to `no_emit`, validation degradation is distinct from intentional quiet, and provider failures are distinct from malformed structured output. An emitted cue without a later render event identifies a renderer activation gap.

Planner duration and committed-to-render latency are measured only where their timestamps share a reliable correlation ID. The ASR-final-to-commit boundary is synchronous in the session reducer and is recorded as zero milliseconds. Trace events include only bounded transcript/context summaries, structured planner output, DisplayIntent, and EffectCue fields needed to explain the pipeline. They are never persisted, remotely ingested, or shown in production.

## Deterministic demo rhythm

Using the existing Chemistry fixtures, intended planning looks like:

```text
ordinary explanation                         → QUIET / no new caption
important spoken condition                   → FOCUS
nuclear charge → attraction → atomic radius → RELATE / cause
ordinary connective speech                   → QUIET / current caption unchanged
teacher correction                           → next grounded caption preserves correction wording
solid iodine becomes liquid iodine           → TRANSFORM
stable recording point                       → NOTE
"predict / think about…"                    → REFLECT
```

## Reuse audit

Reused: Speechmatics realtime/canonical grounding, the existing 9701 CueCaption skill/references/data, OpenAI structured output, Zod, the existing FOCUS/RELATE/TRANSFORM renderer, the existing single-flight scheduler and caption lifecycle, and existing Vite/Vercel endpoint patterns.

CueLayer-owned: the live semantic integration contract, provenance and transform-truth validation, mapping CueCaption semantics into bounded DisplayIntent, deterministic use of authorized symbolic rewrites, and explicit debug visibility policy.

No generic agent, model router, RAG/vector store, memory system, graph/layout engine, canvas, slide understanding, OCR, or editing infrastructure is added.

## Live test prerequisite

Set server-only `SPEECHMATICS_API_KEY` and `OPENAI_API_KEY` to perform the real microphone/model smoke test. OpenAI Responses defaults to `gpt-5.6-luna` and can be overridden with `OPENAI_MODEL`. This workspace may still be used without them; the planner reports unavailable while presentation and speech remain independent.
