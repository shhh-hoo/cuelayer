# CueCaption performer prompt

You are applying the `9701-cuecaption` skill to supplied teacher speech cases. This is a blind evaluation: each case exposes only `caseId`, `transcript`, and `approvedContext`. Produce one JSON object per case and do not add commentary outside JSON.

For every case:

1. Preserve the teacher’s asserted sequence, negation, uncertainty, contrast, correction language, and intentional common-versus-systematic name discussions in `canonicalText`.
2. Treat `canonicalText` as the canonical Plain caption. It must remain speech-faithful and readable; symbolic display is optional and belongs only in `symbolicRewrites`.
3. Populate `protectedPhrases` with chemistry-bearing or pedagogically important spans that must stay atomic.
4. Use `symbolicRewrites` only for semantically equivalent display text grounded in the case. Include the related plain text and a short reason.
5. Put only grounded chemical entities or notation in `chemistryTokens`. Do not solve an equation, generate a structure, complete a mechanism, or identify an omitted reagent/product/condition.
6. Add `decisions` for each important normalisation, FX-only display, preservation, or blocked inference. A decision trace records the policy you believe applies; it is not a self-score.
7. Use `renderHints` only as non-semantic emphasis labels. Prefer the existing vocabulary (`comparison`, `negation`, `formula`, `quantity`, `equation`, `mechanism-term`, `teacher-correction`, `sequence`, `condition`, `practical-step`, `complex-ion`, `reaction-arrow`, `product-comparison`, `causal-link`, `uncertainty`, `transformation`, `equation-layout`). Create a new short kebab-case hint only when none expresses the same non-semantic function. A hint must never add chemistry meaning or prescribe rendering implementation.
8. Put ambiguity and all blocked inferences in `warnings`. Preserve a possible teacher error rather than silently correcting it. Use only these codes: `ASR_AMBIGUITY`, `MISSING_STRUCTURE`, `MISSING_REFERENCE`, `MISSING_REACTION_FACT`, `POSSIBLE_TEACHER_ERROR`, `CONTEXT_CONFLICT`.

Return exactly this shape for each case:

```json
{
  "caseId": "C001",
  "canonicalText": "...",
  "decisions": [{ "label": "CANONICALIZE|FX_ONLY|PRESERVE|BLOCK_INFERENCE", "target": "...", "reason": "..." }],
  "protectedPhrases": [{ "text": "...", "reason": "..." }],
  "symbolicRewrites": [{ "plainText": "...", "displayText": "...", "reason": "equivalent FX-only notation" }],
  "chemistryTokens": [{ "text": "...", "kind": "name|formula|ion|quantity|condition|process" }],
  "renderHints": [{ "target": "...", "kind": "short-kebab-case-label" }],
  "warnings": [{ "code": "...", "message": "..." }]
}
```

Do not use a stored target caption or exact-string comparison. Private semantic contracts are reviewer evidence and are intentionally not supplied to you.
