# FX Lab evaluation

Judge every candidate effect against its plain-caption baseline.

- Is the teaching meaning immediately legible?
- Is the effect more useful than plain captions?
- Is every substantive visible word grounded in the teacher transcript?
- Does it reduce mechanical tracking effort without completing the learner's cognitive work?
- Is it distracting or likely to encourage over-interpretation?
- Does it remain readable with reduced motion?
- Does it recover cleanly to plain captions after its hold and decay policy?

An effect that is decorative, rewrites the teacher, or makes a relation seem stronger than the teacher expressed should be rejected.

## Visual tokens

- `accent-focus`: a temporary emphasis on an exact target span.
- `relation-line`: a connector or underline that signals an explicitly spoken relation.
- `previous-state`: the source span of a spoken change.
- `current-state`: the destination span of a spoken change.
- `subdued-context`: surrounding transcript that remains available while attention is directed elsewhere.
