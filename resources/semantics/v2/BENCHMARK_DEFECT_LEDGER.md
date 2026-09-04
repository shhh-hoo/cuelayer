# SEMANTICS v1 → v2 benchmark defect ledger

**Created:** September 4, 2026  
**Historical baseline:** `alpha-semantics-corpus-v5`, SHA-256 `beeab817fdf90bda679a2ca74bb1b888d10f437638850a37e1c4ab23915e594d`  
**Frozen baseline commit:** `e149f15e2583084b89c2cfc4588de2175896fe9a`

This ledger is the mandatory audit trail for benchmark changes after the first locked evaluation. The existing corpus, manifest, provider results, failure replays, and original evaluation narrative remain immutable historical evidence. V2 uses new files, a new manifest/hash, a versioned evaluator, and fresh provider runs. No v1 holdout output is used as v2 release evidence or production-policy tuning input.

## Changed or reviewed holdout cases

| V1 case | Old expectation | Frozen observed output | Defect classification | V2 correction | Rationale |
|---|---|---|---|---|---|
| `SEM-H041` | Board KEEP; Cue KEEP; any TASK counted as invented | Three of four passes produced Board KEEP + teacher-grounded Cue `SET TASK` | Gold defect: teacher-action authority | Board KEEP; Cue `SET TASK`; false Chemistry remains forbidden | “Identify the error yourselves” explicitly establishes learner work. Protecting Board from the false claim and representing the teacher’s task are independent decisions. |
| `SEM-H050` | Required literal fragments included `if`; missing it became `incorrect_chemistry` | All four passes produced an equivalent conditional: exothermic forward reaction + increasing temperature → reverse direction, without literal `if` | Evaluator defect: lexical proxy for proposition semantics | Structured conditional predicate checks antecedent, consequence, polarity, and direction; no literal `if` requirement | Conditional force can survive grammatical compression. Chemistry must not be marked wrong solely because a conjunction disappears. |
| `SEM-H051` | One shared gold required AUGMENT; core failure was scored as semantic failure; rejected output was scored as checkpoint loss | Candidate never emitted accepted AUGMENT; one candidate pass mislabeled unspoken `Al₂Cl₆` as REPRESENT and omitted required state provenance; rejected runs left evidence pending | Gold + evaluator defects, while preserving a real candidate failure | `goldByProfile`: core expects no unavailable AUGMENT; candidate requires Board AUGMENT with `Al₂Cl₆` and domain provenance. Preservation checks consumed **or pending** evidence | Capability-unavailable behavior must not depress core metrics. Misclassifying unspoken formula knowledge as REPRESENT remains a genuine candidate error. |
| `SEM-H053` | Board KEEP because unrelated expansion was forbidden | Every pass validly represented the current spoken proposition “aluminium chloride forms a dimer” without unrelated chemistry | Fixture defect: valid proposition suppressed | Initial state already contains the dimer proposition; current speech asks to stay on that point; expected Board KEEP and forbids unrelated augmentation | A negative augmentation trap must make the valid current proposition redundant before testing irrelevant additions. |
| `SEM-H056` | Board ADD_SUPPORT although the utterance supplied no supporting proposition | Every pass chose Board KEEP and preserved the QUESTION | Gold/fixture defect: missing teaching content | Natural utterance now supplies concrete supporting context; expect ADD_SUPPORT while QUESTION persists | The benchmark must not require the model to invent the support it is scored for. |
| `SEM-H057` | ADD_SUPPORT targeted generic “Baseline concept” | One pass chose ADD_SUPPORT; three chose SET_ACTIVE | Fixture defect: ambiguous state relationship | Initial Active is a specific collision-theory proposition; current pressure/frequency explanation objectively attaches to it as Support | Support versus Active is meaningful only when the parent teaching object is semantically specified. |
| `SEM-H058` | First QUESTION, then Board answer + Cue resolution | Three passes resolved Cue but failed to put “alternative route” on Board; one core pass passed | **No benchmark defect found; retained as genuine model failure** | V2 uses a new surface form with the same semantic requirement | The second checkpoint explicitly provides the answer. Resolving Cue without establishing that answer on Board remains a real failure. |
| `SEM-H059` | Abstract commands “establish the definition” / “add one supporting condition”; final-state logic inferred preservation from the last ADD_SUPPORT | Three passes returned the requested action sequence but failed final-state judging; one invented an active task and was rejected | Fixture + final-state evaluator defects | Replace meta-commands with actual propositions. Final gold names the exact expected Active proposition and Support relationship after the whole sequence | This case tests ordered Board state, not whether imperative benchmark language becomes classroom work. |
| `SEM-H060` | Meta speech “No learner-visible change is useful”; final state ambiguously “preserved”; all checkpoint IDs required as triggers | Every pass correctly used SET_ACTIVE then KEEP, yet all were marked trigger/final-state failures | Fixture + trigger + final-state evaluator defects | Natural continuation; exact final Active proposition; trigger required only for accepted non-KEEP step | KEEP consumes evidence but does not require a learner-visible trigger contribution. “Preserved” must identify which state is preserved. |

## Cross-cutting evaluator defects

| V1 behavior | V2 rule |
|---|---|
| `checkpoint_loss` inferred from absence in accepted steps | A committed checkpoint is preserved when consumed exactly once **or** still present in runtime pending evidence. Only neither state is loss. |
| `current_trigger_missing` inferred from case-level required checkpoint lists | Inspect accepted non-KEEP steps only. Each must carry an exact current evidence reference from a checkpoint it consumes. KEEP is exempt. |
| Runtime integrity inferred from provider success | Deterministic integration tests own checkpoint preservation, duplicate consumption, replay equality, old-schema compatibility, and later-speech validity. Provider reports record these facts but do not redefine them. |
| Meaning represented by normalized substring conjunctions | Structured semantic predicates separately express entities, proposition polarity, condition antecedent/consequence, causal/transformation direction, uncertainty, quantities, required/forbidden propositions, and leakage boundaries. |
| Final Board state described only as `changed`/`preserved` | V2 identifies exact expected Active semantic predicates, Support predicates, retained/invalidation requirements, and Cue state after the complete sequence. |
| One shared expectation across profiles | V2 uses `goldByProfile.core` and `goldByProfile.augment`; unavailable AUGMENT is excluded from core recall and core semantic failures. |

## V2 coverage corrections

The v2 locked split must contain multiple positive examples for RECONSTRUCT, REPRESENT, QUESTION, TASK, HINT, NOTE, ADD_SUPPORT, SET_ACTIVE, topic shift, teacher correction, Cue persistence, and Cue resolution. Candidate AUGMENT recall uses at least five materially distinct positive holdout cases plus negative traps. Development and holdout cover matched semantic categories with different wording.

This ledger may gain entries only before the v2 corpus/evaluator freeze. Once v2 holdout begins, corrections require another version and a fresh untouched holdout.

## V2 pre-holdout development audit

The first provider-backed development pass was run only after commit `ee1e877`. It was not holdout evidence. The pass exposed the following benchmark/evaluator defects, which were corrected before a new v2 freeze. The original development artifacts remain in version history as the audit input for these corrections.

| Area | Development observation | Classification | Correction before re-freeze |
|---|---|---|---|
| Current-trigger gate | Rejected proposals with no accepted steps were reported as `current_trigger_missing` because expected actions were substituted for accepted interventions | Evaluator defect | Inspect only accepted normalized non-KEEP steps; rejected/no-intervention outcomes are handled by acceptance and decision metrics |
| History reactivation | A valid Cue-only HINT with Board KEEP was reported as Board history reactivation | Evaluator defect | Scope history reactivation to accepted non-KEEP Board actions |
| Correction polarity | “Ionic rather than covalent” was treated as affirmative covalent; an output that removed the old claim and stated only “ionic” was required to repeat negation text | Evaluator/gold defect | Add local negation markers including “rather than”; allow a corrected claim to be absent or explicitly negated once the exact old item is invalidated |
| Symbol normalization | Greek delta and equality notation were not normalized explicitly | Evaluator defect | Normalize `Δ`/`δ` to `delta` and `=` to `equals` before predicate matching |
| Formula Active text | A correct formula-only Board item failed because the item also had to repeat the species name | Gold defect | Exact formula predicate requires the symbolic form; the teacher-spoken base entity remains a separate core-profile predicate |
| RECONSTRUCT fixture | Fluent complete mechanism sentences were labeled RECONSTRUCT even when validly REPRESENTed | Fixture defect | Use clearly fragmented/disfluent mechanism surfaces while preserving matched development/holdout semantics |
| Phrase-shaped predicates | Harmless articles or morphology broke “higher activation energy” and “catalyst/catalysed” matches | Gold defect | Express these as atomic entity/direction groups rather than sentence-fragment substrings |
| Board/Cue composition | Topic + NOTE gold required the Note fact inside Active and disallowed its natural Support placement | Final-state gold defect | Active is exactly the new topic; Support and NOTE each carry the stated fact |
| AUGMENT positives | Imperatives such as “give the formula” were reasonably interpreted as learner TASKs | Fixture defect | State a spoken base proposition and explicitly request Board enrichment while saying no learner task/action |

These changes are based solely on development outputs. The v2 holdout remained unread by the provider and was not used for policy tuning.
