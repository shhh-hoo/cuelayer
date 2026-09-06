# Current semantics baseline

| Question | Current answer |
| --- | --- |
| Current corpus | `resources/semantics/current/corpus.jsonl`, frozen identity `alpha-semantics-corpus-v5`; 60 cases, 40 development / 20 holdout. SHA-256 `107d2315cf4f64c42256955c05f24e6a7c15508a30def82039c69fcf9e43355c`. Corpus, gold and manifest bytes remain frozen. |
| Current evaluator | `server/teaching/semantic-evaluation.ts`, identity `alpha-semantics-evaluator-v5`. One CLI: `scripts/evaluate-semantics.ts`. No dependency on historical evaluator implementations. |
| Current policy/profile | Frozen benchmark: `alpha-core-p4-v7` and `alpha-augment-p4-v7`, `bounded-agent-p4-semantics-v7`; exact digests in manifest. **Production is different:** `alpha-continuous-bounded-v9`, `bounded-agent-continuous-context-v9`, compact references and `necessary-factual-attribution-v1`. Benchmark promotion does not certify this live profile. |
| Current recorded gate | The two recorded v5 core holdout passes met core gates; both augment holdout passes met core and augmentation gates. The preserved MIT sequential/realtime transcript pair drained all 76 cues, with recovered timeouts. These are recorded offline/transcript results, **not live lesson acceptance**. No new provider evaluation is implied by repository cleanup. |
| Known unresolved blockers | Runtime latency/backlog tails; actual model compliance with the necessary-factual-attribution instruction; classification definitions displaced from Support by examples; real browser/audio/ASR latency and physical capture/display limits. |

## Commands and evidence

```sh
npm run eval:semantics:validate
# Explicitly authorized paid evaluation only; existing secure environment supplies credentials:
npm run eval:semantics:live -- --split development --profile core --pass 1
```

Validation and live evaluation write unique local run directories under `.cuelayer/evals/semantics/`. No `.env` autoload or credential command-line arguments. Live evaluation uses `OPENAI_TEACHING_MODEL` (default `gpt-5.6-luna`); lesson replay uses its documented production configuration. Do not infer authorization or budgets from a command example.

Run evidence is not source or gold. The historical v5 results and experiment documents are preserved in the local recovery archive `.cuelayer/pr15-cleanup/pre-cleanup.tar` and complete Git bundle `pre-cleanup.bundle`, covering old head `cc1b03099bdf297e28ce44c65273ca5c1f7ef38f`. Local MIT evidence is under `.cuelayer/output-protocol/2026-09-06/`. These paths are optional local evidence, not dependencies of builds/tests. A fresh clone contains the reproducible corpus and evaluator, not the historical outputs. Long-term shared evidence needs an explicitly managed external archive; this cleanup does not publish one.

## Open semantic investigation

At MIT A#73 / vtt152 (08:20.640–08:25.170), a classification name became Active and its different-phase definition became Support. At A#75 / vtt154 (08:28.620–08:29.980), near-duplicate examples displaced the definition through normal capacity-two eviction. B#59 instead put the distinction in Active and retained it. The confirmed mechanism is model BoardDelta placement interacting with ordinary eviction, not codec loss or an established reducer bug. Whether policy needs a more explicit classification persistence rule remains open.

The proposed invariant, pending human review, is that information necessary to understand a current classification/comparison remains represented while it is Active; replaceable examples may be evicted. `classification-stability-review.test.ts` exercises three authored analogues with the same production reducer. No capacity, lifecycle, classification policy or Board layer is changed. Transcript evidence cannot adjudicate DOM rendering or ASR failures.
