---
name: 9701-cuecaption
description: Produce speech-faithful Cambridge International AS & A Level Chemistry 9701 captions and FX metadata, without inventing chemical meaning or rendering an interface.
---

# 9701 CueCaption

Use this skill when turning a 9701 chemistry teacher's spoken explanation into a caption record. It decides **what text and chemistry semantics may be represented**; a renderer decides how (and whether) to display them.

## Output contract

Return a record with these independent layers:

- `canonicalText`: the readable, speech-faithful Plain caption. Keep the teacher's sequence, qualifiers, uncertainty, comparison, and correction language.
- `protectedPhrases`: spans whose wording is pedagogically or chemically important and must remain atomic (for example, “does not necessarily mean”, “common name”, “rate-determining step”, or an explicitly contrasted pair of names).
- `symbolicRewrites`: semantically equivalent `displayText` for FX only. This is an optional visual form, never a replacement for `canonicalText`.
- `chemistryTokens`: explicit names, formulae, ions, quantities, conditions, state symbols, and named processes grounded in the input or approved context.
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
| `BLOCK_INFERENCE` | Meaning requires structural, contextual, or chemical facts absent from speech or approved context. | Do not add the information; emit a precise warning. |

## Core operating rules

1. Segment the speech into propositions before normalising. Preserve negation, modality, contrast, sequence, and teacher self-correction.
2. Canonicalise only surface conventions that are unambiguous in the available evidence. The Plain caption is the source of truth.
3. Treat familiar names (for example, ethanoic acid/acetic acid, propanone/acetone, methylbenzene/toluene) as recognised aliases. Do not silently rewrite a name merely because another name is more systematic.
4. When the teacher is discussing a common name **versus** a systematic name, preserve both exact terms and their contrast. Do not canonicalise either side away.
5. Put formulae, equations, charges, isotopes, state symbols, arrows, subscripts, superscripts, Greek letters, and units in `chemistryTokens` when explicitly spoken or approved. An FX equivalent may use Unicode or markup, but must not change chemistry.
6. Mark semantic focal points as `protectedPhrases`; do not turn short words into effects without a semantic reason.
7. A warning is information, not a correction. If a teacher statement may be wrong, preserve the spoken claim and flag it; never quietly substitute the presumed right chemistry.

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
