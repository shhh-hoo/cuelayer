# CueLayer Product Charter

## Authority

This Charter is the product-level source of truth for CueLayer. Phase-specific implementation and validation documents may describe a narrower scaffold, but they are subordinate to this Charter and should not redefine the product model.

## Product definition

CueLayer is an AI-native presentation layer for teaching.

It listens to teaching as it unfolds, maintains a speech-faithful semantic source of truth, and adaptively decides what learners should see and when a learner-facing cue is useful. The product aims to reduce tracking and transcription effort while preserving the learner's work of understanding, organising, reviewing, and reflecting.

The canonical speech representation is a grounding layer. Learner-visible output is adaptive rather than synonymous with a continuous transcript.

### Alpha learner-surface boundary

CueLayer Alpha is a bounded learner-surface agent. New lesson evidence is the only deliberation trigger. Teacher speech is primary evidence, but it is not the literal learner-output boundary: the Board may reconstruct, represent, or (when enabled by policy) narrowly augment a teacher assertion; Teaching Cue may reconstruct or represent it. Every visible contribution carries exact speech provenance and, where used, references to existing Teaching State.

Alpha does not autonomously create a task, question, or hint; it does not correct the teacher or initiate a new activity. A teacher-provided hint and an explicit teacher self-correction remain supported state semantics. Teacher override is a contract-only event, with no Alpha UI. Personality, avatar, intervention-level controls, and proactive timers are future work.

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

Every learner-visible representation remains grounded in the teacher's speech, Teaching State, and approved context. Grounding proves provenance, not literal display equality: exact speech quotes support the contribution while the bounded contribution may reconstruct or represent stated meaning. Symbolic or spatial compression may make stated meaning easier to follow while preserving the teacher's asserted meaning, corrections, uncertainty, and deliberate wording.

## Learning cues

Content representation and learner-action timing are separate channels.

The initial learner-intent grammar is:

- `NONE`: the learner continues naturally without an additional cue.
- `NOTE`: the teaching content has formed a stable, worthwhile recording point.
- `REVIEW`: a completed segment or structure warrants brief consolidation before the teaching flow moves on.
- `REFLECT`: the teacher has created a genuine handoff of cognitive work to the learner.

Learning cues are intentionally sparse. Their role is to clarify timing of attention, note-taking, review, and reflection while preserving the learner's responsibility to think and organise.

AI determines pedagogical eligibility for a learner cue. The deterministic runtime determines delivery timing. For example, AI may determine that a structure is worth noting; the runtime can wait until the associated `RELATE` or `TRANSFORM` progression has settled before showing the `NOTE` cue. Visual completion alone does not establish note-worthiness.

`REVIEW` is grounded in a meaningful teaching boundary or consolidation opportunity. `REFLECT` is grounded in pedagogical evidence such as a teacher question, prediction request, comparison prompt, or deliberate invitation to think.

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
