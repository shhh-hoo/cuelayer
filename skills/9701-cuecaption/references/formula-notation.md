# Formula and notation

Keep spoken names readable in `canonicalText`; emit a formula or typographic rewrite only when the speech or approved context grounds it.

| Spoken / Plain form | FX `displayText` | Decision |
| --- | --- | --- |
| carbon dioxide | CO₂ | `FX_ONLY` unless the teacher dictated the formula |
| sulfate ion, two minus | SO₄²⁻ | `FX_ONLY` only if the formula and charge are grounded |
| delta H | ΔH | `FX_ONLY` |
| mole per decimetre cubed | mol dm⁻³ | `FX_ONLY` |
| equilibrium | ⇌ | `FX_ONLY`; do not replace an arrow type absent from speech |

Use conventional subscripts and superscripts only in `symbolicRewrites`. The Plain caption may say “H two O” or “H2O” consistently with supplied transcription conventions, but must not add coefficients, charge, state symbols, isotope notation, or an equation balance.

Treat a formula token as chemistry-bearing. `Na+` is not interchangeable with `Na`; `Cl₂` is not interchangeable with `Cl`; `[Cu(H₂O)₆]²⁺` cannot be invented from “copper complex.”
