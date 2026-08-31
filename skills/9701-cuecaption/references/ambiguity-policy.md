# Ambiguity and conflict policy

Use the least committal representation compatible with the speech.

1. Preserve what is audible or supplied.
2. Canonicalise only an unambiguous surface form.
3. If a display rewrite is equivalent, keep it FX-only.
4. If chemistry requires a missing fact for the current utterance, block inference and name the missing fact.
5. If wording could be an error, preserve it and warn; do not introduce a correction.

## Warning activation

Do not warn simply because speech leaves out a reagent, condition, product, equation, structure, coefficient, charge, state symbol, or mechanism detail. A warning is warranted only when the absence resolves a deictic reference, blocks a transformation actually being considered, creates an explicit ambiguity, conflicts with approved context, or makes the teacher statement possibly chemically wrong.

For example, “Magnesium reacts with oxygen to form magnesium oxide” does not require a warning about unstated coefficients or state symbols. “The product goes on the right” does require `MISSING_REFERENCE` because its referent cannot be resolved. “The electrophile accepts the electron pair” does not require a warning merely because a full mechanism is absent.

## Warning vocabulary

- `ASR_AMBIGUITY`: observable ASR evidence could change chemistry: approved context supplies alternatives/confidence, or the transcript explicitly discusses what was heard. A text question that merely contains two chemical alternatives is not ASR evidence.
- `MISSING_STRUCTURE`: name, isomer, locant, or stereochemistry cannot be fixed from the supplied evidence.
- `MISSING_REFERENCE`: a deictic reference needs a structure, diagram, board item, or other supplied source that is absent.
- `MISSING_REACTION_FACT`: a reagent, condition, product, charge, state symbol, or coefficient was not supplied.
- `POSSIBLE_TEACHER_ERROR`: the statement appears chemically questionable; preserve it for review.
- `CONTEXT_CONFLICT`: approved context conflicts with the speech; do not select one silently.

Warnings should state what was not inferred, not invent the answer.
