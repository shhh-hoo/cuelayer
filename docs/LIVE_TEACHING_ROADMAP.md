# CueLayer Live Teaching Roadmap

**Status:** active execution index  
**Updated:** 2026-09-04

This document maps stable work-package identifiers to GitHub pull requests. The identifiers are durable; pull-request numbers are operational metadata and may change when a draft is replaced, a hotfix is inserted, or a merge wrapper is required.

`docs/LIVE_TEACHING_SYSTEM_SPEC.md` uses only the stable identifiers below. Product contracts, schemas, acceptance IDs, and semantic decisions must never depend on a GitHub PR number.

## Stable work packages

| Work package | Scope | Dependency | Current GitHub mapping |
|---|---|---|---|
| `TRACE-V2` | Durable local diagnostic trace outside the live audio hot path | none | Completed by PR #12; deployment packaging corrected by PR #13. PR #10 is the closed draft predecessor. |
| `LIVE-STATE` | Lossless Lesson Event Log, immutable evidence checkpoints, ordered interpretation deltas, one-in-flight scheduler, replayable Teaching State, and live Board/Teaching Cue `/session` surface | `TRACE-V2` | Completed by merged PR #14 on September 4, 2026 (`b790b550`). |
| `SEMANTICS` | Constrained Alpha capability profile, current-trigger discipline, reconstruction, representation, bounded augmentation evaluation, Board continuity, teacher-originated Cue lifecycle, and semantic safety | `LIVE-STATE` | Draft PR #15 on `feat/alpha-teaching-semantics`; `REVISE`, with `AUGMENT_DISABLED` and live semantic dogfood outstanding. |
| `CONTEXT-POLICY` | Controlled P0–P4 context projection ablation after `SEMANTICS` freezes the policy, corpus, and gates | `SEMANTICS` | Unassigned. Do not reserve a PR number in durable documents. |
| `SPEECH-QUALITY` | ASR language/configuration evaluation, domain vocabulary, critical-term errors, ambiguity signals, and checkpoint evidence quality | `SEMANTICS` | Unassigned. Do not reserve a PR number in durable documents. |
| `STRUCTURED-OBJECTS` | Grounded EquationSpec/ReactionSpec generation and deterministic Board rendering through packaged KaTeX/mhchem | `SEMANTICS`, normally after `SPEECH-QUALITY` evidence | Unassigned. Do not reserve a PR number in durable documents. |

## Current execution order

```text
TRACE-V2                         complete
   ↓
LIVE-STATE                       complete; merged PR #14 (`b790b550`)
   ↓
SEMANTICS                        current; fixed P4
   ↓
CONTEXT-POLICY                   after SEMANTICS policy/corpus/gates freeze
   ↓
SPEECH-QUALITY                   future; PR number assigned only when opened
   ↓
STRUCTURED-OBJECTS               future; PR number assigned only when opened
```

## Development rule

Every implementation PR must identify its work package in its title or description and cite the relevant acceptance IDs from `LIVE_TEACHING_SYSTEM_SPEC.md`.

A PR number does not define scope. The work-package contract does.

Examples:

```text
Work package: LIVE-STATE
GitHub PR: #14
Acceptance IDs: LOG-*, WIN-*, CTX-*, SCH-*, STA-*, SUR-*, E2E-*
```
