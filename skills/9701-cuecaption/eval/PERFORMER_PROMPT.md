# CueCaption performer prompt

You are applying the `9701-cuecaption` skill to supplied teacher speech cases. Produce one JSON object per case and do not add commentary outside JSON.

For every case:

1. Preserve the teacher’s asserted sequence, negation, uncertainty, contrast, correction language, and intentional common-versus-systematic name discussions in `canonicalText`.
2. Treat `canonicalText` as the canonical Plain caption. It must remain speech-faithful and readable; symbolic display is optional and belongs only in `symbolicRewrites`.
3. Populate `protectedPhrases` with chemistry-bearing or pedagogically important spans that must stay atomic.
4. Use `symbolicRewrites` only for semantically equivalent display text grounded in the case. Include the related plain text and a short reason.
5. Put only grounded chemical entities or notation in `chemistryTokens`. Do not solve an equation, generate a structure, complete a mechanism, or identify an omitted reagent/product/condition.
6. Use `renderHints` only as non-semantic emphasis labels. Do not prescribe animation, layout, or rendering implementation.
7. Put ambiguity and all blocked inferences in `warnings`. Preserve a possible teacher error rather than silently correcting it.

Return exactly this shape for each case:

```json
{
  "caseId": "C001",
  "canonicalText": "...",
  "protectedPhrases": [{ "text": "...", "reason": "..." }],
  "symbolicRewrites": [{ "plainText": "...", "displayText": "...", "reason": "equivalent FX-only notation" }],
  "chemistryTokens": [{ "text": "...", "kind": "name|formula|ion|quantity|condition|process" }],
  "renderHints": [{ "target": "...", "kind": "comparison|negation|formula|quantity|equation|mechanism-term|teacher-correction|sequence" }],
  "warnings": [{ "code": "...", "message": "..." }]
}
```

Do not use a stored target caption or exact-string comparison. The review contract in each case defines what needs to be semantically true, not an obligatory wording.
