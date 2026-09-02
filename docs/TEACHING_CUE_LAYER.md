# Teaching Cue Layer

Teaching Cue is an independent learner-facing channel. It does not sit inside the teaching board and it is not a renderer effect.

```text
speech evidence
      ↓
teaching interpretation
   ↙             ↘
board delta   teaching cue state
   ↘             ↙
      learner surface
```

The board answers **what teaching content has changed**. Teaching Cue answers **what unresolved classroom instruction the learner still needs to keep in view**.

## Board visual hierarchy

The board does not use a default title/body/subtitle template. Visual hierarchy comes from semantic role:

- `ACTIVE`: the concept, relation, equation, reaction, or other teaching object currently being established or changed. It owns the strongest visual weight.
- `SUPPORT`: a condition, annotation, definition, or explanation attached to the active object. It should read as part of that object rather than generic body copy.
- `RETAINED`: previously established context that is still required for the current reasoning. It remains visible at deliberately lower weight and is not a scrolling transcript history.

This is a visual/runtime role model, not a new planner taxonomy. The current fixture exercises definition, causal structure, equation, and chemical reaction content using the same three roles.

The intended board behaviour is working-memory-like rather than feed-like: useful structure can remain, new meaning can attach or reorganize it, and completed unrelated context can retreat. A topic label is shown only when the teaching content itself requires one; every board state does not receive an artificial heading.

## Alpha contract

One Teaching Cue may be active at a time:

- `QUESTION`: an unresolved teacher question.
- `TASK`: an instruction the learner is still carrying out.
- `NOTE`: a short reminder that the current material is worth recording.
- `HINT`: a hint the teacher has actually given. Alpha does not invent new problem-solving hints.

`QUESTION`, `TASK`, and `HINT` are persistent by default and leave through explicit resolution or replacement. `NOTE` is transient by default. A new active cue replaces the old one.

Teaching Cue has its own lifecycle. Board updates do not automatically clear it, and resolving a Teaching Cue does not remove teaching content from the board.

## Integration boundary

This slice deliberately does not change the live planner schema or session reducer while PR #8 is changing trace/session hot paths. `/teaching-cues` is the executable fixture for the contract and visual layer. After the Session Event Store work settles, Teaching Interpretation can feed this state through a small adapter and trace cue activation/replacement/resolution independently of board deltas.
