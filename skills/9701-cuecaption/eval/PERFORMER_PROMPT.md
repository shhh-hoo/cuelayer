# CueCaption performer prompt

You are applying the `9701-cuecaption` skill to supplied teacher speech cases. This is a blind evaluation: each case exposes only `caseId`, `transcript`, and `approvedContext`. Produce one JSON object per case and do not add commentary outside JSON.

For every case:

1. Preserve the teacher’s asserted sequence, negation, uncertainty, contrast, correction language, code-switched connective/copular language, and intentional common-versus-systematic name discussions in `canonicalText`. Do not translate code-switching merely for stylistic uniformity.
2. Treat `canonicalText` as the canonical Plain caption. It must remain speech-faithful and readable; symbolic display is optional and belongs only in `symbolicRewrites`.
3. Populate `protectedPhrases` with the smallest chemistry-bearing or pedagogically important spans that must stay atomic. Do not protect an entire proposition merely because it contains a comparison, sequence, negation, or transformation; use `renderHints` for the relationship.
4. Use `symbolicRewrites` only for semantically equivalent display text grounded in the case. Include the related plain text and a short reason.
5. Put only grounded chemical entities or notation in `chemistryTokens`, using `substance`, `ion`, `formula`, `symbol`, `quantity`, `unit`, `process`, `concept`, `condition`, or `observation`. Do not solve an equation, generate a structure, complete a mechanism, or identify an omitted reagent/product/condition.
6. Add `decisions` for each important normalisation, FX-only display, preservation, or blocked inference. A decision trace records the policy you believe applies; it is not a self-score.
7. Use `renderHints` only as non-semantic emphasis labels. Prefer the existing vocabulary (`comparison`, `negation`, `formula`, `quantity`, `equation`, `mechanism-term`, `teacher-correction`, `sequence`, `condition`, `practical-step`, `complex-ion`, `reaction-arrow`, `product-comparison`, `causal-link`, `uncertainty`, `transformation`, `equation-layout`). Create a new short kebab-case hint only when none expresses the same non-semantic function. A hint must never add chemistry meaning or prescribe rendering implementation.
8. Do not canonicalise a chemical name that is explicitly negated, quoted as an incorrect alternative, being corrected, or compared metalinguistically. You may separately canonicalise a grounded positive assertion; preserve the rejected form intact.
9. Warnings require an active reason: a missing current referent, a transformation actually blocked, an explicit ambiguity, an approved-context conflict, or a possible teacher chemistry error. Do not warn merely because an unrequested chemical detail is absent. `ASR_AMBIGUITY` requires observable ASR evidence in approved context or transcript language explicitly about what was heard; alternatives in a text question alone are not ASR evidence. Use only these codes: `ASR_AMBIGUITY`, `MISSING_STRUCTURE`, `MISSING_REFERENCE`, `MISSING_REACTION_FACT`, `POSSIBLE_TEACHER_ERROR`, `CONTEXT_CONFLICT`.

Return exactly this shape for each case:

```json
{
  "caseId": "C001",
  "canonicalText": "...",
  "decisions": [{ "label": "CANONICALIZE|FX_ONLY|PRESERVE|BLOCK_INFERENCE", "target": "...", "reason": "..." }],
  "protectedPhrases": [{ "text": "...", "reason": "..." }],
  "symbolicRewrites": [{ "plainText": "...", "displayText": "...", "reason": "equivalent FX-only notation" }],
  "chemistryTokens": [{ "text": "...", "kind": "substance|ion|formula|symbol|quantity|unit|process|concept|condition|observation" }],
  "renderHints": [{ "target": "...", "kind": "short-kebab-case-label" }],
  "warnings": [{ "code": "...", "message": "..." }]
}
```

Do not use a stored target caption or exact-string comparison. Private semantic contracts are reviewer evidence and are intentionally not supplied to you.
