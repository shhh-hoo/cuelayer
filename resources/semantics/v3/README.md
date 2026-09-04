# SEMANTICS v3

This frozen evaluation revision repairs the Cue taxonomy and Alpha release-gate semantics found after v2 review. It preserves v1 and v2 unchanged.

- Teacher-originated imperative cognitive actions are `TASK`, including writing, reading, and predicting.
- Speech-grounded `RECONSTRUCT` versus `REPRESENT` is diagnostic rather than a core release gate when visible semantics and provenance are valid.
- The provider returns checkpoint identities; deterministic normalization attaches canonical immutable evidence text to accepted events.
- A valid `SET_ACTIVE` may survive an invalid optional Support, which is dropped with `board_support_dropped`.
- `AUGMENT` remains a distinct authority boundary and is evaluated strictly.

Run `npm run eval:semantics:v3:validate` for deterministic validation. Provider evaluation uses `npm run eval:semantics:v3:live -- --split development --profile core --pass 1` and writes immutable run artifacts under `results/`.
