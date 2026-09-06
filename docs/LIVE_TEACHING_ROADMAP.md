# Live teaching roadmap

The [System Spec](LIVE_TEACHING_SYSTEM_SPEC.md) defines current behavior. This page owns work-package status and PR mapping; the [baseline](SEMANTICS_BASELINE.md) owns evidence and unresolved gates.

| Work package | Status / scope | PR mapping |
| --- | --- | --- |
| TRACE-V2 | Durable diagnostic trace foundation | Completed in #12/#13 |
| LIVE-STATE | Lossless domain events and replayable teaching surface | Foundation merged in #14 |
| SEMANTICS | Continuous teaching, bounded context, compact references, attribution contract, replay and browser latency instrumentation | Draft #15, `feat/alpha-teaching-semantics`; not live accepted |
| CONTEXT-POLICY | Further controlled projection evaluation only after current baseline review | Unassigned |
| SPEECH-QUALITY | Real audio/ASR fidelity and ambiguity investigation | Unassigned |
| STRUCTURED-OBJECTS | Grounded structured equations/reactions and deterministic rendering | Unassigned |

## Current order

1. Keep PR15 limited to a reviewable implementation, canonical evaluator/current fixtures and current documentation. Generated run evidence stays outside tracked source.
2. Review the cleaned final code/configuration and known baseline limitations.
3. Conduct the controlled manual MIT diagnostic procedure to measure browser/audio/ASR → state → DOM latency. No paid run or playback is authorized merely by this roadmap.
4. Review classification-definition persistence and model attribution compliance as separate scoped decisions. Do not increase Support capacity or alter deadlines to mask defects.

Do not add functionality while closing the repository hygiene/review gate. No automatic merge, deployment or live/product PASS follows from engineering checks. Use stable work-package and acceptance IDs in reviews; PR numbers are operational metadata, not semantic identifiers.
