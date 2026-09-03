# CueLayer Product Charter

## Authority

This Charter is the product-level source of truth for CueLayer. Phase-specific implementation and validation documents may describe a narrower scaffold, but they are subordinate to this Charter and should not redefine the product model.

## Product definition

CueLayer is an AI-native learner-surface agent for live teaching.

CueLayer listens to teaching as it unfolds, preserves a replayable record of lesson evidence, maintains an evolving model of the current learning state, and autonomously decides what learners should see or continue thinking about. The product aims to reduce tracking and transcription effort while preserving the learner's work of understanding, organising, reviewing, and reflecting.

The canonical speech representation is a grounding layer. Learner-visible output is adaptive rather than synonymous with a continuous transcript.

### Alpha learner-surface authority

CueLayer Alpha optimizes for the quality of the learner's current learning state, not fidelity to the teacher transcript. New lesson evidence is the only deliberation trigger: it controls when the model deliberates, not what the learner surface is permitted to contain. Once triggered, Alpha reasons from new evidence, processed lesson history, current Teaching State, and domain knowledge.

Teacher speech is primary classroom evidence and context, rather than an authorization boundary. Alpha may reconstruct, reorganize, supplement, connect, correct, and initiate bounded learner actions. Contributions carry attributable provenance: exact speech quotes are required when speech is claimed, while domain- and state-based contributions must not manufacture speech provenance. Interventions are governed by epistemic correctness, contextual relevance, pedagogical timing, attention value, and reversible classroom control.

Teacher override remains a contract-only event, with no Alpha UI. Personality, avatar, intervention-level controls, and proactive timers remain future work.

## Primary experience

The teacher teaches naturally. CueLayer interprets the live explanation and turns useful structure into a restrained learner-visible surface.

The learner experience is organised around two questions:

1. What should I notice right now?
2. What should I do right now?

The learner-visible surface can combine presentation content, selective text, semantic visual structure, and sparse learning cues.

## AI-native operating model

Natural teaching is the primary interface.

AI handles interpretation where meaning or pedagogical intent is uncertain: what the teacher is expressing, whether a visible intervention is useful, how current speech relates to Teaching State, and whether the current teaching moment warrants a learner-facing cue.

Deterministic software handles predictable execution: validation, target grounding, bounded visual grammar, layout, animation treatment, timing policy, state transitions, fallback, stale-result handling, and rendering.

```text
teacher speech + Teaching State
              ↓
     canonical speech state
              ↓
      AI interpretation
        ↙           ↘
 display intent   learner intent
        ↘           ↙
 deterministic compiler/runtime
              ↓
    learner-visible surface
```

AI-native behaviour is expressed through autonomous interpretation of natural teaching, not through generation frequency or an AI-labelled interface.

## Teaching State

Interpretation is stateful across teaching turns. CueLayer maintains Teaching State rather than treating each utterance as an isolated request.

Teaching State can accumulate semantic relationships, current topic, recently established concepts, unresolved references, teacher corrections, incomplete causal or procedural structures, and pedagogical phase across speech turns. This allows an explanation to grow as the teacher develops it.

Early implementations may use a compact recent-context representation, but the runtime and planner should preserve continuity across turns and remain compatible with richer state as the product develops.

## Adaptive representation

CueLayer treats representation as a policy decision rather than assuming every spoken word should remain visible.

Planner-level display intents are:

- `QUIET`: the best learner-visible state is visual quiet.
- `TEXT`: readable speech-derived text is the useful representation.
- `FOCUS`: direct attention to one minimal semantic anchor.
- `RELATE`: expose an explicitly grounded cause, sequence, or contrast.
- `TRANSFORM`: show the same object, expression, or state changing representation or state.

Display intents are planner-level semantic decisions. They compile into renderer state and bounded effect cues; they are not necessarily renderer cue kinds. In particular, `QUIET` and `TEXT` may resolve to ordinary renderer state rather than new `EffectCue.kind` values.

`QUIET` is a successful decision. A useful CueLayer session should contain substantial visually quiet time.

Every learner-visible representation remains attributable to speech evidence, Teaching State, domain knowledge, or their combination. Grounding proves provenance, not literal display equality or subject-matter truth: exact claimed speech quotes support a contribution, while bounded reconstructions, representations, augmentations, and corrections may use the appropriate non-speech provenance. Symbolic or spatial compression may make meaning easier to follow while preserving evidence history, corrections, uncertainty, and reversible classroom control.

## Learning cues

Content representation and learner-action timing are separate channels.

The Alpha learner-action grammar is:

- `NONE`: the learner continues naturally without an additional cue.
- `NOTE`: the teaching content has formed a stable, worthwhile recording point.
- `QUESTION`: a diagnostic or comparison question is useful now.
- `TASK`: a bounded cognitive action should remain active.
- `HINT`: a bounded nudge supports progress without supplying the complete answer.

Learning cues are intentionally sparse. Their role is to clarify timing of attention, note-taking, review, and reflection while preserving the learner's responsibility to think and organise.

AI determines pedagogical eligibility and may originate a learner action; deterministic code owns validation, lifecycle, timing, and bounds. A new action must not gratuitously replace an unresolved high-priority task or question, and the surface must not reveal a complete answer while productive learner work remains unresolved. Visual completion alone does not establish note-worthiness.

## Product invariants

1. **Natural teaching is the control surface.** The teacher's normal explanation drives the system.
2. **Canonical speech is a grounding source, not a permanent display requirement.** When the speech pipeline is available, raw and canonical speech state ground interpretation, correction handling, replay, debugging, and learner-visible representation.
3. **Adaptive representation is the default product model.** The system selects among quiet, text, semantic structure, and learning cues according to the teaching moment.
4. **Selective intervention is a feature.** `QUIET` and `NONE` are first-class outcomes.
5. **Interpretation is stateful.** Teaching turns contribute to an evolving Teaching State rather than being treated as unrelated requests.
6. **AI interprets; deterministic code executes.** Semantic and pedagogical intent compile into a bounded, testable visual runtime.
7. **Learner-visible meaning is grounded.** Visual compression preserves the teacher's actual assertions and supported context.
8. **Presentation transport remains independent from semantic interpretation.** A presentation can provide the visual background while semantic slide understanding remains a separate capability.
9. **Failure domains degrade independently.** Presentation transport continues independently of speech recognition and semantic planning. Speech-pipeline failure affects speech-derived representations without taking down presentation transport. Planner failure falls back to a suitable `TEXT` or `QUIET` state from whatever grounded speech state is available; planner latency does not block capture or rewind the learner-visible surface.
10. **Usable vertical slices drive development.** Each implementation step should improve an end-to-end teaching experience that can be dogfooded.

## Product review gate

A proposal is aligned only when it preserves all product invariants above and materially strengthens at least one of these product outcomes:

- the teacher can continue teaching naturally with less software operation;
- the learner receives a clearer, better-timed representation of the explanation;
- the learner receives a well-timed cue to note, review, or reflect;
- Teaching State makes the current representation more coherent with the evolving explanation;
- the end-to-end teaching experience becomes more usable, resilient, or testable in a real session.

Implementation quality, technical elegance, or visual novelty alone do not establish product alignment.
