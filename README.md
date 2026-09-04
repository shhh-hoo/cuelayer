# CueLayer

CueLayer is an AI-native learner-surface agent for live teaching. It turns live speech evidence into a replayable Teaching State and a restrained learner-facing Board and Cue.

## Live architecture

```text
Speechmatics → canonical speech → immutable lesson checkpoints
→ pending scheduler → /api/teaching/interpretation → accepted TeachingContribution events
→ deterministic Teaching State → TeachingSurfaceLayer → BoardLayout + TeachingCueLayer
```

Speech is evidence and grounding; it is not automatically learner-visible. Durable TRACE-V2 records diagnostic evidence independently of the lesson event log.

## Development

```sh
npm ci
npm run dev
```

Set the server-only values in [`.env.example`](.env.example): `SPEECHMATICS_API_KEY` for live speech and `OPENAI_API_KEY` for teaching interpretation. `OPENAI_MODEL` is optional.

Open `/session` for the learner surface. Use `/session?debug=speech` for canonical-speech inspection and durable trace export; it is not the normal learner view.

## Authorities

- [Product Charter](docs/PRODUCT_CHARTER.md)
- [Live Teaching System Specification](docs/LIVE_TEACHING_SYSTEM_SPEC.md)
- [Live Teaching Roadmap](docs/LIVE_TEACHING_ROADMAP.md)
- [TRACE-V2 architecture](docs/TRACE_ARCHITECTURE_V2.md)
- [Speechmatics live grounding](docs/SPEECHMATICS_LIVE_GROUNDING.md)
