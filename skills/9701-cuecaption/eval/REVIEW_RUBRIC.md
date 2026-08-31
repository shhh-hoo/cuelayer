# Semantic review rubric

Review the model result against a case’s semantic contract, not an exact target string. A concise valid paraphrase is acceptable when it preserves the contract.

## Dimensions

| Dimension | Review question |
| --- | --- |
| Chemical correctness | Does the output avoid chemical falsehoods and preserve any speaker claim that is flagged rather than silently repaired? |
| Semantic fidelity | Are asserted facts, sequence, negation, uncertainty, contrast, and corrections faithfully retained? |
| 9701 convention | Are classroom-appropriate names, formulae, units, and mechanism terms represented conventionally without preferred-IUPAC overreach? |
| Inference restraint | Did the output avoid adding an isomer, locant, stereo label, reagent, condition, product, charge, state symbol, or equation balance without grounding? |
| Caption quality | Is `canonicalText` clear, readable, speech-faithful Plain text rather than a diagram, answer key, or notation dump? |
| FX suitability | Are symbolic rewrites genuinely equivalent, optional display forms, while render hints remain non-semantic? |
| Ambiguity handling | Are ambiguity/conflict/possible-error warnings explicit, useful, and non-corrective? |

## Severity and verdict

- **Critical** — invented or silently corrected chemistry; reversed or erased negation; wrong charge/formula/stereochemistry; an unsafe conclusion from missing evidence. Verdict: `REJECT` unless a corrected rerun removes it.
- **Major** — loses a required fact, important contrast, protected phrase, uncertainty, or usable warning; treats FX notation as the Plain caption; incompatible 9701 convention. Verdict: normally `REVISE`.
- **Minor** — a non-essential protection/hint is absent, a label is imprecise, or formatting can improve without changing meaning. Verdict: `REVISE` or `ACCEPT` with notes.

Use one verdict per case:

- `ACCEPT`: no Critical or Major problem; remaining Minor issues do not impair semantic use.
- `REVISE`: repairable issue(s) with no remaining unsafe chemical fabrication.
- `REJECT`: Critical breach, repeated Major breaches, or output not usable as a caption-semantic record.

Record dimensions assessed, findings with severity, verdict, and one classification: `skill_gap`, `model_execution_failure`, `source_ambiguity`, or `none`.

## Finding classification

- **Skill gap**: the contract or references lack a needed decision rule, leading multiple reasonable performers to inconsistent outcomes. Update the skill only after a reproducible pattern is demonstrated.
- **Model execution failure**: the skill and contract clearly forbid or require the behaviour, but the performer disregards them. Improve prompting or model execution; do not broaden the domain policy unnecessarily.
- **Source ambiguity**: speech and approved context cannot resolve the chemistry, or they conflict. A preserved caption plus explicit warning can be the correct result; escalate the source rather than inventing a conclusion.

## Small baseline-versus-skill comparison

Use 12–15 representative cases: C002, C004, C006, C007, C010, C013, C019, C024, C029, C034, C040, C048, C054, C056, and C058. Run the same model with a neutral caption-record prompt (baseline) and then with the assembled skill prompt. Blind-review outputs using this rubric. Compare only semantic outcomes: grounded facts retained, ungrounded facts added, warnings supplied, and optional FX equivalence. Do not score literal wording overlap.

This evaluation is a qualitative development workflow, not a CI pass/fail gate. CI may only check that YAML, JSON, and JSONL inputs parse and that required fields are present.
