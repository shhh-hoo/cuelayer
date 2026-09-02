# CueLayer Live Teaching Roadmap

**Status:** active execution index  
**Updated:** 2026-09-03

This document maps stable work-package identifiers to GitHub pull requests. The identifiers are durable; pull-request numbers are operational metadata and may change when a draft is replaced, a hotfix is inserted, or a merge wrapper is required.

`docs/LIVE_TEACHING_SYSTEM_SPEC.md` uses only the stable identifiers below. Product contracts, schemas, acceptance IDs, and semantic decisions must never depend on a GitHub PR number.

## Stable work packages

| Work package | Scope | Dependency | Current GitHub mapping |
|---|---|---|---|
| `TRACE-V2` | Durable local diagnostic trace outside the live audio hot path | none | Completed by PR #12; deployment packaging corrected by PR #13. PR #10 is the closed draft predecessor. |
| `LIVE-STATE` | Lossless Lesson Event Log, immutable evidence checkpoints, P4 context projection, ordered interpretation deltas, one-in-flight scheduler, replayable Teaching State, and live Board/Teaching Cue `/session` surface | `TRACE-V2` | Next planned implementation: PR #14. |
| `SEMANTICS` | Stateful teaching policy, multi-turn sequence corpus, correction/topic-shift/Cue lifecycle semantics, and P0–P4 context ablation | `LIVE-STATE` | Planned after `LIVE-STATE`: PR #15, provided PR #14 is merged without an intervening PR. |
| `SPEECH-QUALITY` | ASR language/configuration evaluation, domain vocabulary, critical-term errors, ambiguity signals, and checkpoint evidence quality | `SEMANTICS` | Unassigned. Do not reserve a PR number in durable documents. |
| `STRUCTURED-OBJECTS` | Grounded EquationSpec/ReactionSpec generation and deterministic Board rendering through packaged KaTeX/mhchem | `SEMANTICS`, normally after `SPEECH-QUALITY` evidence | Unassigned. Do not reserve a PR number in durable documents. |

## Current execution order

```text
TRACE-V2                         complete
   ↓
LIVE-STATE                       next; currently expected PR #14
   ↓
SEMANTICS                        after LIVE-STATE; currently expected PR #15
   ↓
SPEECH-QUALITY                   future; PR number assigned only when opened
   ↓
STRUCTURED-OBJECTS               future; PR number assigned only when opened
```

The two currently assigned implementation numbers are therefore:

- PR #14: `LIVE-STATE` — `feat: make lossless lesson interpretation drive the live teaching surface`
- PR #15: `SEMANTICS` — `feat: validate stateful teaching semantics and context policy`

If another PR is inserted before either one, update only this mapping. Do not renumber or rewrite `LIVE_TEACHING_SYSTEM_SPEC.md`.

## Development rule

Every implementation PR must identify its work package in its title or description and cite the relevant acceptance IDs from `LIVE_TEACHING_SYSTEM_SPEC.md`.

A PR number does not define scope. The work-package contract does.

Examples:

```text
Work package: LIVE-STATE
GitHub PR: #14
Acceptance IDs: LOG-*, WIN-*, CTX-*, SCH-*, STA-*, SUR-*, E2E-*
```

```text
Work package: SEMANTICS
GitHub PR: #15
Acceptance IDs: CTX-*, STA-*, WIN-04/05, SCH-02/03/05/06, SUR-01/05, E2E-02..05
```

## Historical numbering note

Earlier revisions of the live-system specification referred to the same work as PR10/PR11, then PR12/PR13, and then PR14/PR15. Those numbers reflected repository sequencing, not product-design changes. This roadmap permanently separates the two.