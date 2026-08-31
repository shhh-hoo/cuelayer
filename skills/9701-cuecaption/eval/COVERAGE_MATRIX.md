# Round 1 coverage matrix

Each cell names one curated seed case. The six input forms deliberately repeat across every content family so a model cannot treat a correct convention in one domain as permission to infer missing chemistry in another. Cases may contain more than one decision label.

| Content family | Clean formal speech | Colloquial / common name | Bilingual / code-switched | ASR-like confusable | Underspecified reference | Metalinguistic naming discussion |
| --- | --- | --- | --- | --- | --- | --- |
| Organic nomenclature | C001 | C002 | C003 | C004 | C005 | C006 |
| Formula and ions | C007 | C008 | C009 | C010 | C011 | C012 |
| Equations and reactions | C013 | C014 | C015 | C016 | C017 | C018 |
| Physical chemistry notation | C019 | C020 | C021 | C022 | C023 | C024 |
| Organic transformations | C025 | C026 | C027 | C028 | C029 | C030 |
| Mechanism language | C031 | C032 | C033 | C034 | C035 | C036 |
| Isomerism / stereochemistry | C037 | C038 | C039 | C040 | C041 | C042 |
| Analysis / practical | C043 | C044 | C045 | C046 | C047 | C048 |
| Ambiguity / conflict | C049 | C050 | C051 | C052 | C053 | C054 |

## Targeted stress cases

- C055: protected contrast with two recognised aliases.
- C056: a formula-only structural-isomer trap.
- C057: stated equation plus an unstated condition.
- C058: plausible teacher chemistry error; preserve and warn.
- C059: speaker/context conflict.
- C060: nested negation and uncertainty in a mechanism explanation.

Round 1 has 60 seed cases: 9 content families × 6 input forms plus 6 multi-risk stress cases. Its overlapping decision-label counts, computed from `cases-round-1.jsonl`, are: `CANONICALIZE` 4, `FX_ONLY` 9, `PRESERVE` 56, and `BLOCK_INFERENCE` 24.

Round 1 intentionally has strong coverage of preservation, ambiguity, semantic restraint, and blocked inference. It is not a balanced benchmark of every CueCaption transformation. Round 2 challenge generation should deliberately increase `CANONICALIZE`, `FX_ONLY`, and new chemistry-entity coverage; no Round 2 cases are included here.
