# Challenge generator prompt

Generate adversarial-but-realistic 9701 chemistry teacher-speech cases to test CueCaption semantic restraint. Each new case must include a semantic review contract, not a mandatory expected caption string.

Output JSONL. Each line must include:

```json
{
  "caseId": "new unique id",
  "contentFamily": "one of the Round 1 families",
  "inputForm": "one of the Round 1 forms",
  "transcript": "teacher speech only",
  "approvedContext": null,
  "policyDecisions": ["CANONICALIZE|FX_ONLY|PRESERVE|BLOCK_INFERENCE"],
  "factsToPreserve": ["..."],
  "preferredConventions": ["..."],
  "allowedTransformations": ["..."],
  "forbiddenInferences": ["..."],
  "ambiguityPolicy": "..."
}
```

Generate cases that force a choice between readable Plain text, equivalent FX notation, protected wording, and an inference block. Include clean, colloquial, bilingual, ASR-like, underspecified, and metalinguistic inputs. Spread across nomenclature, formulae/ions, reactions, physical notation, transformations, mechanisms, stereochemistry, analysis/practical, and conflict.

Reject your own candidate if it:

- requires a full chemistry parser, ASR system, knowledge-base lookup, diagram rendering, or a completed reaction/mechanism;
- defines a one true expected output phrase;
- asks the model to infer a structural isomer, locant, stereochemical label, reagent, condition, product, charge, state symbol, or correction not grounded in the case;
- treats a recognised common name as automatically chemically wrong;
- normalises away a teacher’s explicit common-versus-systematic naming discussion.

Prefer short, reviewable utterances with one or two genuine semantic traps. Approved context, when used, must directly resolve a named ambiguity and must not be hidden background knowledge.
