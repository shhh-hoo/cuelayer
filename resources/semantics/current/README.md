# Current frozen semantic corpus

`corpus.jsonl` and `manifest.json` are the byte-identical frozen v5 inputs (60 cases: 40 development, 20 holdout). Versioned identities inside the manifest remain unchanged; directory names are not benchmark history.

Validate with `npm run eval:semantics:validate`. The single evaluator is `server/teaching/semantic-evaluation.ts`. Generated results go to unique directories under `.cuelayer/evals/semantics/`, never here. Corpus/gold changes require separate review; there is no command that silently rebuilds gold from a prior version.

See [the evaluation contract](../../../docs/EVALUATION.md) for current compatibility limits and migration rules. Historical execution evidence belongs in ignored local storage or a separately managed archive, not this source tree.
