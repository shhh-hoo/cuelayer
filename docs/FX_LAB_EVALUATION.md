# FX Lab evaluation

Judge every candidate effect against its plain-caption baseline.

- Is the teaching meaning immediately legible?
- Is the effect more useful than plain captions?
- Is every substantive visible word source-traceable to speech, an approved lesson source, or an explicit normalisation rule?
- Does it reduce mechanical tracking effort without completing the learner's cognitive work?
- Is it distracting or likely to encourage over-interpretation?
- Does it remain readable with reduced motion?
- Does it recover cleanly to plain captions after its hold and decay policy?

An effect that is decorative, rewrites the teacher, or makes a relation seem stronger than the teacher expressed should be rejected.

## Caption-composition metrics and failure categories

- **Unsupported visible substantive content rate**: visible substantive content without valid provenance. V0 target: **zero**.
- **Referent-resolution accuracy**: correct trusted-context completions divided by attempted completions.
- **Terminology-correction accuracy**: correct glossary-backed corrections divided by attempted corrections.
- **Omission precision**: safe suppressions divided by all suppressions.
- **Critical omission rate**: instructional content incorrectly removed. V0 target: **zero**.
- **Semantic-fidelity failures**: changed meaning, inferred relation, silent factual correction, or generated explanation.
- **Provenance coverage**: visible composed-caption fragments carrying one or more valid source references.

Inspect RAW, PLAIN, and FX separately: RAW is debug evidence; PLAIN tests caption composition; FX tests the same caption with motion. The learner-visible stage never includes provenance or debug metadata.

## Visual tokens

- `accent-focus`: a temporary emphasis on an exact target span.
- `relation-line`: a connector or underline that signals an explicitly spoken relation.
- `previous-state`: the source span of a spoken change.
- `current-state`: the destination span of a spoken change.
- `subdued-context`: surrounding transcript that remains available while attention is directed elsewhere.
