# Ambiguity and conflict policy

Use the least committal representation compatible with the speech.

1. Preserve what is audible or supplied.
2. Canonicalise only an unambiguous surface form.
3. If a display rewrite is equivalent, keep it FX-only.
4. If chemistry requires a missing fact, block inference and name the missing fact.
5. If wording could be an error, preserve it and warn; do not introduce a correction.

## Warning patterns

- `ASR_AMBIGUITY`: competing transcriptions could change chemistry (for example, “chloride” / “chlorate”).
- `MISSING_STRUCTURE`: name, isomer, locant, or stereochemistry cannot be fixed from the supplied evidence.
- `MISSING_REACTION_FACT`: a reagent, condition, product, charge, state symbol, or coefficient was not supplied.
- `POSSIBLE_TEACHER_ERROR`: the statement appears chemically questionable; preserve it for review.
- `CONTEXT_CONFLICT`: approved context conflicts with the speech; do not select one silently.

Warnings should state what was not inferred, not invent the answer.
