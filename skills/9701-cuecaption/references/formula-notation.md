# Formula and notation

Keep spoken names readable in `canonicalText`; emit a formula or typographic rewrite only when the speech or approved context grounds it.

| Spoken / Plain form | FX `displayText` | Decision |
| --- | --- | --- |
| carbon dioxide | CO₂ | `FX_ONLY` unless the teacher dictated the formula |
| sulfate ion, two minus | SO₄²⁻ | `FX_ONLY` only if the formula and charge are grounded |
| enthalpy change | ΔH | `FX_ONLY` |
| Gibbs free energy change | ΔG | `FX_ONLY` |
| activation energy | E_A | `FX_ONLY`; `A` is semantic, not a lowercase subscript character |
| standard electrode potential | E⦵ | `FX_ONLY` |
| standard cell potential | E⦵cell | `FX_ONLY` |
| mole per decimetre cubed | mol dm⁻³ | `FX_ONLY` |

These physical-chemistry symbols are limited to conventions grounded in the official 9701 syllabus source listed in `eval/SOURCES.md`. `E_A` is the semantic symbol; a future renderer may typeset `A` as a subscript without changing that semantic representation. `E°` is not the preferred generated 9701 convention, but preserve it when a teacher discusses it metalinguistically. When speech supplies the relationship “enthalpy change is negative”, an FX-only rewrite may be `ΔH < 0`; `canonicalText` remains spoken wording. The numerical/chemical negative sign is not the linguistic `negation` render hint: use a sign or `comparison` hint as appropriate.

## Formula typography in Plain text

When speech explicitly dictates a formula, or approved context supplies the formula for transcription normalisation, conventional formula typography may be `CANONICALIZE`d in `canonicalText`: “NH four plus” → `NH₄⁺`. This is surface normalisation of supplied formula content.

When the teacher speaks a chemical name or prose instead, keep that name in `canonicalText`; formula conversion is `FX_ONLY`: “ammonium ion” stays “ammonium ion”, with optional `NH₄⁺` display text. Neither route permits adding coefficients, charges, state symbols, isotopes, stoichiometry, or species identity not grounded in evidence.

## Reversible-reaction notation

`⇌` is FX-only only when speech or approved context explicitly concerns a reversible reaction, the reversible-reaction arrow, forward/reverse reaction notation, or an equivalent reaction-direction representation. “At equilibrium, the concentrations remain constant” is not equivalent to `⇌` and must not be rewritten merely because “equilibrium” appears. A stated reversible reaction may use `⇌` only when approved context does not conflict.

Treat a formula token as chemistry-bearing. `Na+` is not interchangeable with `Na`; `Cl₂` is not interchangeable with `Cl`; `[Cu(H₂O)₆]²⁺` cannot be invented from “copper complex.”
