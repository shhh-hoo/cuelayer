# CueLayer Evaluation Contract

This document owns reproducible evaluation definitions and current compatibility facts. It is not a product authority, execution diary, or archive of model runs.

## What belongs here

Track only artifacts required to reproduce or interpret the current evaluation surface:

- canonical evaluator and CLI identity;
- frozen reviewed corpus / manifest identity;
- supported semantic profiles used by that corpus;
- commands for offline validation and explicitly authorized live evaluation;
- known compatibility gaps that materially affect interpretation of results.

Generated model output, paid-run reports, real captions, session traces, latency exports, and experiment notebooks belong in ignored `.cuelayer/` or `artifacts/`, or in an explicitly managed external evidence archive.

## Current frozen semantic corpus

- Corpus: `resources/semantics/current/corpus.jsonl`
- Corpus identity: `alpha-semantics-corpus-v5`
- Cases: 60 total, 40 development / 20 holdout
- SHA-256: `107d2315cf4f64c42256955c05f24e6a7c15508a30def82039c69fcf9e43355c`
- Evaluator: `server/teaching/semantic-evaluation.ts`
- Evaluator identity: `alpha-semantics-evaluator-v5`
- CLI: `scripts/evaluate-semantics.ts`

The corpus, gold, manifest, and evaluator identity remain frozen unless a scoped evaluation change deliberately updates them.

## Compatibility warning

The frozen v5 benchmark evaluates legacy semantic profiles (`alpha-core-p4-v7`, `alpha-augment-p4-v7`, `bounded-agent-p4-semantics-v7`). The current live PR15 runtime uses a later continuous/bounded profile and still implements the legacy Board-slot ontology.

Therefore:

- a passing v5 benchmark does not certify the live runtime;
- the existing corpus must not be silently reinterpreted as proof of the Core/Canvas model;
- the Core-domain migration requires a new reviewed evaluation contract rather than mutating frozen gold in place;
- historical benchmark identities may remain readable for comparison, but they do not define future product semantics.

## Commands

```sh
npm run eval:semantics:validate
```

Paid provider evaluation is run only when explicitly authorized by the task and secure runtime configuration. Do not infer authorization from documentation examples or previous runs.

Evaluation output must remain outside tracked source. Repository validation must not create or modify tracked evaluation artifacts.

## Acceptance boundary

Offline evaluator passes establish only the behavior measured by that corpus and evaluator. They do not establish:

- real microphone / ASR fidelity;
- real browser/audio-to-DOM latency;
- learner attention quality;
- correctness of a newly introduced domain schema;
- long-lesson Canvas behavior;
- real-world lesson acceptance.

Real-lesson acceptance must use separately defined evidence and must not be inferred from synthetic or transcript-only passes.

## Migration rule

When the production Board domain migrates from legacy `SET_ACTIVE` / bounded `Retained` semantics to persistent Cores and local semantic operations:

1. preserve the frozen v5 corpus/evaluator as historical compatibility evidence if still useful;
2. introduce a new evaluation identity for the new semantic contract;
3. review new gold rather than mechanically translating old slot-based expectations;
4. keep renderer/layout evaluation separate from semantic interpretation evaluation where possible;
5. record run output outside tracked source.
