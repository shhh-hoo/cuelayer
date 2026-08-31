---
name: 9701-cuecaption
description: Produce speech-faithful Cambridge International AS & A Level Chemistry 9701 captions and FX metadata, without inventing chemical meaning or rendering an interface.
---

# 9701 CueCaption

Use this skill when turning a 9701 chemistry teacher's spoken explanation into a caption record. It decides **what text and chemistry semantics may be represented**; a renderer decides how (and whether) to display them.

## Output contract

Return a record with these independent layers:

- `canonicalText`: the readable, speech-faithful Plain caption. Keep the teacher's sequence, qualifiers, uncertainty, comparison, and correction language.
- `protectedPhrases`: the smallest semantically irreducible spans whose wording is pedagogically or chemically important and must remain atomic (for example, “common name” or “rate-determining step”). Do not protect an entire proposition merely because it contains a comparison, sequence, negation, or transformation; represent that relationship with `renderHints`.
- `symbolicRewrites`: semantically equivalent `displayText` for FX only. This is an optional visual form, never a replacement for `canonicalText`.
- `chemistryTokens`: grounded entities using only `substance`, `ion`, `formula`, `symbol`, `quantity`, `unit`, `process`, `concept`, `condition`, or `observation`. This is a small caption taxonomy, not a chemical ontology.
- `renderHints`: non-semantic emphasis hints such as `comparison`, `negation`, `equation`, `formula`, `quantity`, `mechanism-term`, or `teacher-correction`.
- `warnings`: ambiguity, probable ASR confusion, speaker uncertainty, possible chemistry error, and every blocked inference.

Do not create a drawing, slide, reaction plan, knowledge-base answer, caption composition system, ASR system, AI effect plan, or a full chemical parser.

## Decision labels

Classify each proposed transformation separately; a case may carry more than one label.

| Decision | Use when | Result |
| --- | --- | --- |
| `CANONICALIZE` | Spoken form unambiguously denotes a standard 9701 caption convention and does not erase a teaching contrast. | Normalise spelling, hyphenation, symbols, units, formula typography, or an unambiguous systematic name. |
| `FX_ONLY` | A symbolic or typographic display is equivalent but would make the Plain caption less speech-faithful. | Keep plain wording in `canonicalText`; place the display form only in `symbolicRewrites`. |
| `PRESERVE` | The wording is a protected phrase, a familiar recognised alias, a metalinguistic example, an uncertainty, or possibly deliberate teacher phrasing. | Retain it in the Plain caption and, where useful, mark it protected. Recognition is not a verdict that an alias is chemically wrong. |
| `BLOCK_INFERENCE` | Meaning requires structural, contextual, or chemical facts absent from speech or approved context. | Do not add the information. Warn only when the absence actively blocks the current utterance under the warning-activation rule. |

## Core operating rules

1. Segment the speech into propositions before normalising. Preserve negation, modality, contrast, sequence, and teacher self-correction.
2. Canonicalise only surface conventions that are unambiguous in the available evidence. The Plain caption is the source of truth. Do not canonicalise a name that is explicitly negated, quoted as an incorrect alternative, being corrected, or being compared metalinguistically. A positively asserted name may be canonicalised separately when grounded.
3. Treat familiar names (for example, ethanoic acid/acetic acid, propanone/acetone, methylbenzene/toluene) as recognised aliases. Do not silently rewrite a name merely because another name is more systematic.
4. When the teacher is discussing a common name **versus** a systematic name, preserve both exact terms and their contrast. Do not canonicalise either side away.
5. Put formulae, equations, charges, isotopes, state symbols, arrows, subscripts, superscripts, Greek letters, and units in `chemistryTokens` when explicitly spoken or approved. An FX equivalent may use Unicode or markup, but must not change chemistry.
6. Mark semantic focal points as minimal `protectedPhrases`; do not turn short words into effects without a semantic reason. For example, protect “Acetic acid”, “common name”, “ethanoic acid”, and “systematic name” separately, then use a comparison hint for their relationship. Likewise, “same molecular formula” and “different structural formulae” are normally separate units.
7. Preserve code-switched connective and copular language in `canonicalText`. Do not translate it merely for stylistic uniformity unless the input includes a correction or an approved transcription replacement.
8. A warning is information, not a correction. If a teacher statement may be wrong, preserve the spoken claim and flag it; never quietly substitute the presumed right chemistry.

## Warning activation

Absence alone does not create a warning. Do not warn merely because speech omits a reagent, condition, product, equation, structure, coefficient, or mechanism detail. Warn only when missing information resolves a deictic reference in the current utterance, blocks a transformation actually under consideration, creates an explicit ambiguity, conflicts with approved context, or makes the spoken claim possibly chemically wrong.

`ASR_AMBIGUITY` requires observable evidence: approved context containing alternatives or confidence, or transcript language explicitly about what was heard. Two alternatives in a text question alone are not ASR evidence.

## Hard inference boundary

Always use `BLOCK_INFERENCE` rather than guessing any of the following:

- a structural isomer from molecular formula alone;
- locants not supplied by a structure, explicit speech, or approved context;
- E/Z, cis/trans, R/S, optical activity, or other stereochemical labels without sufficient information;
- reagents, conditions, products, charges, state symbols, or stoichiometric coefficients not grounded in speech or approved context;
- a silent correction to a possible teacher chemistry error.

An approved context must be supplied with the case and must directly resolve the point. General syllabus knowledge does not license filling a gap.

## Reference routing

- Read [nomenclature.md](references/nomenclature.md) for organic names, aliases, locants, and metalinguistic name discussions.
- Read [formula-notation.md](references/formula-notation.md) for formulae, ions, quantities, units, and Plain-versus-FX notation.
- Read [reaction-conventions.md](references/reaction-conventions.md) for equations, transformations, conditions, and evidence thresholds.
- Read [mechanism-conventions.md](references/mechanism-conventions.md) for 9701 mechanism vocabulary without attempting to generate mechanisms.
- Read [ambiguity-policy.md](references/ambiguity-policy.md) whenever the speech is underspecified, ASR-like, contradictory, or potentially wrong.
- Read [syllabus-boundary.md](references/syllabus-boundary.md) to keep the skill within caption semantics for 9701.

## Quality check

Before outputting, ask: “Could a student recover exactly what the teacher asserted, including uncertainty, without the caption adding chemistry?” If not, preserve more or block more. A visually nicer formulation never outweighs semantic fidelity.
