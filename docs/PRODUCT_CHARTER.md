# CueLayer Product Charter

## Authority

This Charter is the product-level source of truth for CueLayer. Phase-specific implementation and validation documents may describe a narrower scaffold, but they are subordinate to this Charter and should not redefine the product model.

## Product definition

CueLayer is an AI-native learner-surface agent for live teaching.

CueLayer listens to teaching as it unfolds, preserves a replayable record of lesson evidence, maintains an evolving model of the current learning state, and autonomously decides what learners should see or continue thinking about. The product aims to reduce tracking and transcription effort while preserving the learner's work of understanding, organising, reviewing, and reflecting.

The canonical speech representation is a grounding layer. Learner-visible output is adaptive rather than synonymous with a continuous transcript.

### Alpha learner-surface authority

CueLayer's longer-term direction is a learner-surface agent with broader, reversible teaching support. The current Alpha deliberately proves a narrower authority boundary first.

Alpha is a bounded learner-surface agent, not a transcript formatter. It autonomously decides whether the Board or Teaching Cue should change and treats `QUIET`/`KEEP` as successful outcomes. New lesson evidence is the only deliberation trigger. Once triggered, Alpha may reason from new evidence, processed lesson history, current Teaching State, and domain knowledge; teacher speech is grounding and context, not a literal display boundary.

Alpha may reconstruct damaged teaching expressions, reorganize an established proposition without changing its meaning, and use narrowly validated domain knowledge for Board augmentation. It does not autonomously correct the teacher or initiate learner actions. Teaching Cue represents only learner actions established by current classroom evidence, including teacher-originated notes, questions, tasks, and hints.

Contributions carry attributable provenance. The model names immutable speech checkpoints; deterministic code resolves accepted references to the complete canonical checkpoint text, so punctuation or formatting differences cannot fabricate or detach evidence. Domain- and state-based contributions must not manufacture speech provenance. Broader correction and initiation authority, teacher approval and override controls, intervention-level controls, personality, avatar, voice, and proactive triggers remain later work. `teacher_override.applied` remains contract-only in Alpha.

## Primary experience

The teacher teaches naturally. CueLayer interprets the live explanation and turns useful structure into a restrained learner-visible surface.

The learner experience is organised around two questions:

1. What should I notice right now?
2. What should I do right now?

The learner-visible surface can combine presentation content, selective text, semantic visual structure, and sparse learning cues.

## AI-native operating model

Natural teaching is the primary interface.

AI handles interpretation where meaning or pedagogical intent is uncertain: what the teacher is expressing, whether a visible intervention is useful, how current speech relates to Teaching State, and whether the current teaching moment warrants a learner-facing cue.

Deterministic software handles predictable execution: validation, provenance, bounded Board/Cue state, layout, lifecycle policy, stale-result handling, and rendering.

```text
teacher speech → canonical speech → lesson checkpoints
                               ↓
                       AI interpretation
                               ↓
                 accepted contribution events
                               ↓
                   deterministic Teaching State
                               ↓
                    learner-visible surface
```

AI-native behaviour is expressed through autonomous interpretation of natural teaching, not through generation frequency or an AI-labelled interface.

## Teaching State

Interpretation is stateful across teaching turns. CueLayer maintains Teaching State rather than treating each utterance as an isolated request.

Teaching State can accumulate semantic relationships, current topic, recently established concepts, unresolved references, teacher corrections, incomplete causal or procedural structures, and pedagogical phase across speech turns. This allows an explanation to grow as the teacher develops it.

The runtime preserves continuity through immutable checkpoints, accepted contributions, and deterministic replay rather than a temporary caption context.

## Adaptive representation

CueLayer treats representation as a policy decision rather than assuming every spoken word should remain visible. The interpreter proposes bounded Board and Teaching Cue deltas; the deterministic reducer controls their lifecycle, retention, and visual hierarchy. Visual quiet is a successful outcome.

Every learner-visible representation remains attributable to speech evidence, Teaching State, domain knowledge, or their combination. Grounding proves provenance, not literal display equality or subject-matter truth: accepted speech references resolve to immutable canonical checkpoints, while bounded reconstructions, representations, augmentations, and corrections may use the appropriate provenance. Symbolic or spatial compression may make meaning easier to follow while preserving evidence history, corrections, uncertainty, and reversible classroom control.

## Learning cues

Content representation and learner-action timing are separate channels.

The Alpha learner-action representation grammar is:

- `NONE`: the learner continues naturally without an additional cue.
- `NOTE`: the teaching content has formed a stable, worthwhile recording point.
- `QUESTION`: a diagnostic or comparison question is useful now.
- `TASK`: a bounded cognitive action should remain active.
- `HINT`: a bounded nudge supports progress without supplying the complete answer.

Learning cues are intentionally sparse. Their role is to preserve the timing of teacher-originated attention, note-taking, questions, tasks, and hints while preserving the learner's responsibility to think and organise.

AI determines whether current classroom evidence establishes a learner action and may reconstruct or represent that action; it may not originate one in Alpha. Deterministic code owns validation, lifecycle, timing, and bounds. A represented action must not gratuitously replace an unresolved task or question, and the surface must not reveal a complete answer while productive learner work remains unresolved. Visual completion alone does not establish note-worthiness.

## Product invariants

1. **Natural teaching is the control surface.** The teacher's normal explanation drives the system.
2. **Canonical speech is a grounding source, not a permanent display requirement.** When the speech pipeline is available, raw and canonical speech state ground interpretation, correction handling, replay, debugging, and learner-visible representation.
3. **Adaptive representation is the default product model.** The system selects among quiet, text, semantic structure, and learning cues according to the teaching moment.
4. **Selective intervention is a feature.** `QUIET` and `NONE` are first-class outcomes.
5. **Interpretation is stateful.** Teaching turns contribute to an evolving Teaching State rather than being treated as unrelated requests.
6. **AI interprets; deterministic code executes.** Contributions become bounded, testable Teaching State before rendering.
7. **Learner-visible meaning is grounded.** Visual compression preserves the teacher's actual assertions and supported context.
8. **Presentation transport remains independent from semantic interpretation.** A presentation can provide the visual background while semantic slide understanding remains a separate capability.
9. **Failure domains degrade independently.** Presentation transport continues independently of speech recognition and interpretation. Speech-pipeline failure affects speech-derived representations without taking down presentation transport. Interpretation failure preserves the last valid Teaching State and never blocks capture or rewinds the learner-visible surface.
10. **Usable vertical slices drive development.** Each implementation step should improve an end-to-end teaching experience that can be dogfooded.

## Product review gate

A proposal is aligned only when it preserves all product invariants above and materially strengthens at least one of these product outcomes:

- the teacher can continue teaching naturally with less software operation;
- the learner receives a clearer, better-timed representation of the explanation;
- the learner receives a well-timed cue to note, review, or reflect;
- Teaching State makes the current representation more coherent with the evolving explanation;
- the end-to-end teaching experience becomes more usable, resilient, or testable in a real session.

Implementation quality, technical elegance, or visual novelty alone do not establish product alignment.
