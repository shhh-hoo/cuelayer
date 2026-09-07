# CueLayer

CueLayer is an AI-native learner surface for live teaching. It turns live teaching evidence into replayable lesson knowledge and a restrained learner-facing Board and Teaching Cue.

## Live architecture

```text
Speechmatics → canonical speech → immutable lesson checkpoints
→ ordered pending scheduler → teaching interpretation
→ validated accepted domain events → deterministic lesson state
→ attention / spatial projection → learner surface
```

Speech is evidence and grounding; it is not automatically learner-visible. Diagnostic trace records execution evidence independently of the replayable lesson event log.

The current PR15 runtime still contains legacy Board-slot implementation (`SET_ACTIVE`, bounded Support/Retained, `TEXT/FOCUS/RELATION/TRANSFORM`). Those shapes are migration debt, not future product authority. See `docs/SYSTEM_CONTRACT.md` before extending the Board domain.

## Development

```sh
npm ci
npm run dev
```

Set server-only values in [`.env.example`](.env.example), including Speechmatics and OpenAI credentials where required. Do not expose provider credentials through client-prefixed environment variables.

Open `/session` for the normal learner surface. Use `/session?debug=speech` only for explicit speech/trace diagnostics and export.

## Repository authorities

Product direction and learner-experience decisions are maintained outside this repository. The repository owns executable contracts and reproducible technical behavior, not the product North Star.

- [System contract](docs/SYSTEM_CONTRACT.md) — executable live-teaching authority and Core-domain migration target.
- [Trace contract](docs/TRACE.md) — durable diagnostic trace boundary.
- [Evaluation contract](docs/EVALUATION.md) — reproducible evaluator/corpus identities and compatibility limits.
- [Runbook](docs/RUNBOOK.md) — local development, validation, trace, and authorized diagnostic procedures.
- [Repository instructions](AGENTS.md) — contributor/Codex working rules.

Git history, pull-request descriptions, spike reports, benchmark run reports, and implementation comments are evidence or implementation context. They do not redefine product semantics.

## Evaluation and evidence

```sh
npm run eval:semantics:validate
npm run check:repo -- --clean
```

Offline validation does not establish live product acceptance. Paid provider calls, microphone/video playback, and private trace uploads require explicit task authorization.

Track source, reviewed synthetic fixtures, and the current frozen corpus required for reproducibility. Keep generated model outputs, real captions, traces, latency exports, and experiment notebooks in ignored `.cuelayer/`, `artifacts/`, or an explicitly managed external evidence archive.
