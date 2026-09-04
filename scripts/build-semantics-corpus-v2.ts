import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LESSON_EVENT_SCHEMA_VERSION,
  type CompactEvidenceCheckpoint,
  type ContributionMode,
  type LessonEvent,
  type TeachingCueKind,
} from "../src/lesson-stream/contracts.ts";
import { replayLessonEvents } from "../src/lesson-stream/replay.ts";
import { ALPHA_AUGMENT_CANDIDATE_P4, ALPHA_CORE_P4 } from "../src/lesson-stream/semantic-profile.ts";
import { persistedAuditDigest } from "../src/trace/audit.ts";
import { teachingProviderContract } from "../server/teaching/provider-contract.ts";
import type { SemanticCorpusCaseV2, SemanticPredicate, V2ProfileGold } from "../server/teaching/semantic-evaluation-v2.ts";

type Action = "KEEP" | "SET_ACTIVE" | "ADD_SUPPORT";
type CueAction = "KEEP" | "SET" | "RESOLVE_CURRENT";
type Surface = { holdout: string[]; development: [string[], string[]] };
type Scenario = {
  key: string;
  tags: string[];
  surface: Surface;
  board: Action[];
  cue?: CueAction[];
  cueKinds?: Array<TeachingCueKind | null>;
  mode?: ContributionMode;
  predicate?: SemanticPredicate;
  corePredicate?: SemanticPredicate;
  cuePredicate?: SemanticPredicate;
  activePredicate?: SemanticPredicate;
  supportPredicates?: SemanticPredicate[];
  initialActive?: string | null;
  initialCue?: { kind: TeachingCueKind; content: string };
  initialRetained?: string;
  continuity?: "same_thread" | "topic_shift" | "correction";
  invalidations?: "INITIAL_ACTIVE" | "INITIAL_RETAINED";
  mustAugment?: boolean;
  negativeAugment?: boolean;
  risk?: "low" | "medium" | "critical";
  rationale: string;
};

const aliases = (...values: string[]) => values;
const clause = (...values: Array<string | string[]>) => ({ allOf: values.map((value) => Array.isArray(value) ? value : [value]) });
const entities = (...values: Array<string | string[]>) => ({ entities: values.map((value) => Array.isArray(value) ? value : [value]) });

const formula = (value: string, ...entityValues: string[]): SemanticPredicate => ({
  ...entities(...entityValues),
  requiredLexical: [[value]],
});

const scenarios: Scenario[] = [
  {
    key: "reconstruct-ammonium-formula",
    tags: ["reconstruct", "set-active", "formula"],
    surface: {
      holdout: ["Write ammonium as N H four with a positive charge."],
      development: [["Put N H four plus on the board for the ammonium ion."], ["The ammonium formula is N H four, charge plus one."]],
    },
    board: ["SET_ACTIVE"], mode: "RECONSTRUCT", predicate: formula("nh4+", "ammonium"),
    rationale: "Reconstruct a teacher-spoken formula without adding an unspoken proposition.",
  },
  {
    key: "reconstruct-fragmented-mechanism",
    tags: ["reconstruct", "set-active", "transformation"],
    surface: {
      holdout: ["The alkene, then the electrophile, makes the carbocation intermediate."],
      development: [["Alkene attacks electrophile and we get a carbocation."], ["From the carbon double bond and the electrophile, form the carbocation intermediate."]],
    },
    board: ["SET_ACTIVE"], mode: "RECONSTRUCT",
    predicate: { transformations: [{ from: clause(["alkene", "double bond"], "electrophile"), to: clause("carbocation", "intermediate") }] },
    rationale: "Reconstruct fragmented teacher speech into one faithful transformation.",
  },
  {
    key: "conditional-equilibrium-direction",
    tags: ["represent", "set-active", "condition", "direction", "chemistry"],
    surface: {
      holdout: ["For an exothermic forward reaction, raising temperature favours the reverse direction."],
      development: [["When the forward process releases heat, a temperature increase shifts equilibrium backwards."], ["Temperature going up favours reverse reaction where the forward reaction is exothermic."]],
    },
    board: ["SET_ACTIVE"], mode: "REPRESENT",
    predicate: {
      conditions: [{ antecedent: clause("forward", ["exothermic", "releases heat"]), consequence: clause(["raising temperature", "temperature increase", "temperature going up"], ["reverse", "backwards"]), forbiddenReverse: clause(["raising temperature", "temperature increase"], ["forward direction", "favours forward"]) }],
    },
    rationale: "Judge the conditional proposition and direction, not the literal conjunction used.",
  },
  {
    key: "ordered-active-support",
    tags: ["represent", "set-active", "add-support", "polarity", "runtime", "checkpoint-loss", "duplicate-consumption", "replay", "schema-compatibility"],
    surface: {
      holdout: ["Establish that a catalyst offers another pathway.", "That route does not increase the activation energy; it lowers it."],
      development: [["A catalyst supplies an alternative reaction route.", "Its pathway lowers, rather than raises, activation energy."], ["The catalysed reaction follows another pathway.", "Activation energy is not higher on that route; it is lower."]],
    },
    board: ["SET_ACTIVE", "ADD_SUPPORT"], mode: "REPRESENT", initialActive: null,
    activePredicate: { propositions: [clause("catalyst", ["alternative pathway", "another pathway", "another route", "alternative reaction route"])] },
    supportPredicates: [{ propositions: [clause(["activation energy", "energy barrier"], ["lowers", "lower"])], polarity: [{ claim: clause(["activation energy", "energy barrier"], ["raises", "higher", "increase"]), value: "negated" }] }],
    predicate: { propositions: [clause("catalyst", ["alternative pathway", "another pathway", "another route", "alternative reaction route"]), clause(["activation energy", "energy barrier"], ["lowers", "lower"])], polarity: [{ claim: clause(["activation energy", "energy barrier"], ["raises", "higher", "increase"]), value: "negated" }] },
    rationale: "Require an exact final Active plus Support state across two accepted checkpoints.",
  },
  {
    key: "task-persistence-resolution",
    tags: ["represent", "task", "add-support", "cue-persistence", "cue-resolution"],
    surface: {
      holdout: ["While you keep comparing the collision rates, greater pressure causes more frequent collisions.", "Comparison finished; stop the task now."],
      development: [["Continue your collision task: higher pressure means collisions happen more often.", "You have completed that task."], ["Keep working on the comparison while increased pressure raises collision frequency.", "The comparison task is done; put it aside."]],
    },
    board: ["ADD_SUPPORT", "KEEP"], cue: ["KEEP", "RESOLVE_CURRENT"], cueKinds: [null, null], mode: "REPRESENT",
    initialActive: "Collision frequency controls reaction rate.", initialCue: { kind: "TASK", content: "Compare the two collision rates." },
    predicate: { causalDirections: [{ cause: clause(["greater pressure", "higher pressure", "increased pressure"]), effect: clause(["more frequent collisions", "collisions happen more often", "raises collision frequency"]) }] },
    supportPredicates: [{ causalDirections: [{ cause: clause(["greater pressure", "higher pressure", "increased pressure"]), effect: clause(["more frequent collisions", "collisions happen more often", "raises collision frequency"]) }] }],
    rationale: "Attach concrete support while a TASK persists, then resolve only on explicit completion.",
  },
  {
    key: "question-persistence-answer-resolution",
    tags: ["represent", "question", "add-support", "set-active", "cue-persistence", "cue-resolution", "backlog"],
    surface: {
      holdout: ["Keep considering the catalyst question; lower activation energy is relevant context, but not the answer yet.", "Now the answer: the catalyst supplies an alternative route. That question is resolved."],
      development: [["The question stays open; just note that the barrier is lower.", "Answer it now: a catalyst gives a different pathway, so close the question."], ["Do not close the catalyst question while I add that activation energy decreases.", "The explanation is an alternative reaction route; we can resolve the question."]],
    },
    board: ["ADD_SUPPORT", "SET_ACTIVE"], cue: ["KEEP", "RESOLVE_CURRENT"], cueKinds: [null, null], mode: "REPRESENT",
    initialActive: "Catalysts affect reaction pathways.", initialCue: { kind: "QUESTION", content: "What does the catalyst do?" },
    activePredicate: { propositions: [clause("catalyst", ["alternative route", "different pathway", "alternative reaction route"])] },
    predicate: { propositions: [clause("catalyst", ["alternative route", "different pathway", "alternative reaction route"])] },
    rationale: "Preserve the QUESTION through context, then require its spoken answer on Board before resolution.",
  },
  {
    key: "hint-with-support",
    tags: ["represent", "hint", "add-support", "teacher-originated"],
    surface: {
      holdout: ["Add that the uncatalysed route has the taller barrier. Here is your hint: compare the activation energies."],
      development: [["The route without catalyst has higher activation energy; hint, contrast both barriers."], ["Support the diagram with the higher uncatalysed barrier, and use comparing activation energies as the hint."]],
    },
    board: ["ADD_SUPPORT"], cue: ["SET"], cueKinds: ["HINT"], mode: "REPRESENT",
    initialActive: "Catalysed and uncatalysed reaction profiles.",
    predicate: { propositions: [clause(["uncatalysed", "without catalyst"], ["higher activation energy", "taller barrier", "higher uncatalysed barrier"])], entities: [["compare", "contrast"], ["activation energies", "barriers"]] },
    cuePredicate: { entities: [["compare", "contrast"], ["activation energies", "barriers"]] },
    supportPredicates: [{ propositions: [clause(["uncatalysed", "without catalyst"], ["higher activation energy", "taller barrier", "higher uncatalysed barrier"])] }],
    rationale: "Represent a teacher-authored HINT independently from a concrete Board support fact.",
  },
  {
    key: "note-with-active",
    tags: ["represent", "note", "set-active", "teacher-originated"],
    surface: {
      holdout: ["The key idea is dynamic equilibrium: forward and reverse rates are equal. Make that your note."],
      development: [["Write this note: at dynamic equilibrium, forward rate equals reverse rate."], ["Set dynamic equilibrium as the central point, and note that both reaction rates match."]],
    },
    board: ["SET_ACTIVE"], cue: ["SET"], cueKinds: ["NOTE"], mode: "REPRESENT",
    predicate: { propositions: [clause("dynamic equilibrium", "forward", "reverse", ["rates are equal", "rate equals", "rates match"])] },
    rationale: "Create an explicit NOTE while establishing the same spoken central proposition.",
  },
  {
    key: "correction-active",
    tags: ["represent", "set-active", "teacher-correction", "correction", "chemistry"],
    surface: {
      holdout: ["Correction: sodium chloride is ionic, not covalent."],
      development: [["I need to fix that: sodium chloride has ionic bonding, not covalent bonding."], ["Replace my last claim; NaCl is ionic rather than covalent."]],
    },
    board: ["SET_ACTIVE"], mode: "REPRESENT", initialActive: "Sodium chloride is covalent.", continuity: "correction", invalidations: "INITIAL_ACTIVE",
    predicate: { entities: [["sodium chloride", "nacl"]], polarity: [{ claim: clause("ionic"), value: "affirmed" }, { claim: clause("covalent"), value: "negated" }] },
    rationale: "Represent an explicit teacher correction and remove the corrected active error.",
  },
  {
    key: "correction-retained",
    tags: ["represent", "set-active", "teacher-correction", "correction", "retained-invalidation", "chemistry"],
    surface: {
      holdout: ["Go back and correct the retained statement: magnesium oxide is ionic, not covalent."],
      development: [["The earlier retained MgO claim needs correction; its bonding is ionic, not covalent."], ["Fix the old magnesium oxide point: say ionic rather than covalent."]],
    },
    board: ["SET_ACTIVE"], mode: "REPRESENT", initialActive: "Current bonding summary.", initialRetained: "Magnesium oxide is covalent.", continuity: "correction", invalidations: "INITIAL_RETAINED",
    predicate: { entities: [["magnesium oxide", "mgo"]], polarity: [{ claim: clause("ionic"), value: "affirmed" }, { claim: clause("covalent"), value: "negated" }] },
    rationale: "Invalidate a specifically identified retained error rather than only replacing Active.",
  },
  {
    key: "topic-shift-later-keep",
    tags: ["represent", "set-active", "topic-shift", "later-speech-valid", "quiet"],
    surface: {
      holdout: ["We are leaving kinetics; organic nomenclature is now the main topic.", "Take a quiet moment to read that heading."],
      development: [["Finish reaction rates and move the lesson focus to naming organic compounds.", "Pause there while everyone reads."], ["New topic: organic naming, not kinetics.", "No new teaching point while the class looks at it."]],
    },
    board: ["SET_ACTIVE", "KEEP"], mode: "REPRESENT", initialActive: "Reaction kinetics.", continuity: "topic_shift",
    activePredicate: { entities: [["organic nomenclature", "naming organic compounds", "organic naming"]] },
    predicate: { entities: [["organic nomenclature", "naming organic compounds", "organic naming"]] },
    rationale: "A later KEEP must not invalidate the exact Active state established earlier in the backlog.",
  },
  {
    key: "topic-shift-note",
    tags: ["represent", "set-active", "topic-shift", "note", "teacher-originated"],
    surface: {
      holdout: ["Now switch to electrolysis. Note that reduction occurs at the cathode."],
      development: [["Leave equilibrium and begin electrolysis; write down that the cathode is where reduction happens."], ["Our new topic is electrolysis, with this note: cathode means reduction."]],
    },
    board: ["SET_ACTIVE"], cue: ["SET"], cueKinds: ["NOTE"], mode: "REPRESENT", initialActive: "Chemical equilibrium.", continuity: "topic_shift",
    predicate: { propositions: [clause("electrolysis", "cathode", "reduction")] },
    rationale: "Exercise a topic shift paired with an explicitly teacher-authored NOTE.",
  },
  {
    key: "augment-aluminium-dimer",
    tags: ["augment", "must-augment", "set-active", "formula", "chemistry"],
    surface: {
      holdout: ["Aluminium chloride forms a dimer; supply its compact molecular formula."],
      development: [["Give the molecular formula for the aluminium chloride dimer."], ["Show the compact formula of dimeric aluminium chloride."]],
    },
    board: ["SET_ACTIVE"], mustAugment: true, corePredicate: entities("aluminium chloride", "dimer"), predicate: formula("al2cl6", "aluminium chloride", "dimer"),
    rationale: "Candidate AUGMENT must supply Al₂Cl₆ with explicit domain provenance; core is not scored for unavailable capability.",
  },
  {
    key: "augment-ammonium-charge",
    tags: ["augment", "must-augment", "set-active", "formula", "chemistry"],
    surface: {
      holdout: ["The species is the ammonium ion; add its formula and charge."],
      development: [["Supply the charged formula for ammonium."], ["Augment ammonium ion with its symbolic formula."]],
    },
    board: ["SET_ACTIVE"], mustAugment: true, corePredicate: entities("ammonium"), predicate: formula("nh4+", "ammonium"),
    rationale: "Candidate AUGMENT must add the unspoken NH₄⁺ formula with domain provenance.",
  },
  {
    key: "augment-carbonate-charge",
    tags: ["augment", "must-augment", "set-active", "formula", "chemistry"],
    surface: {
      holdout: ["We mean the carbonate ion; provide its formula including charge."],
      development: [["Add the full charged formula for carbonate."], ["Show carbonate ion symbolically, charge included."]],
    },
    board: ["SET_ACTIVE"], mustAugment: true, corePredicate: entities("carbonate"), predicate: formula("co32-", "carbonate"),
    rationale: "Candidate AUGMENT must add CO₃²⁻ without pretending it was spoken.",
  },
  {
    key: "augment-activation-energy-symbol",
    tags: ["augment", "must-augment", "set-active", "symbol", "chemistry"],
    surface: {
      holdout: ["Activation energy is our quantity; add its standard symbol."],
      development: [["Put the conventional symbol beside activation energy."], ["Annotate activation energy using the usual symbol."]],
    },
    board: ["SET_ACTIVE"], mustAugment: true, corePredicate: entities("activation energy"), predicate: formula("ea", "activation energy"),
    rationale: "Candidate AUGMENT must add Eₐ with domain provenance.",
  },
  {
    key: "augment-enthalpy-symbol",
    tags: ["augment", "must-augment", "set-active", "symbol", "chemistry"],
    surface: {
      holdout: ["Enthalpy change is the quantity here; include its conventional symbol."],
      development: [["Add the usual symbol for enthalpy change."], ["Label enthalpy change with standard notation."]],
    },
    board: ["SET_ACTIVE"], mustAugment: true, corePredicate: entities(["enthalpy change", "enthalpy"]), predicate: { entities: [["enthalpy change", "enthalpy"]], requiredLexical: [["dh", "delta h", "δh"]] },
    rationale: "Candidate AUGMENT must add ΔH with domain provenance.",
  },
  {
    key: "negative-augment-duplicate",
    tags: ["augment", "negative-augment-trap", "history-reactivation", "hint", "teacher-originated"],
    surface: {
      holdout: ["Aluminium chloride still forms the same dimer already shown. Hint: use the displayed formula only; do not branch into other reactions."],
      development: [["The dimer formula on the board remains enough. Here is the hint: read that formula, with no extra chemistry."], ["Keep the existing aluminium chloride dimer. Hint only: use what is visible and add no reaction examples."]],
    },
    board: ["KEEP"], cue: ["SET"], cueKinds: ["HINT"], mode: "REPRESENT", initialActive: "Aluminium chloride dimer: Al₂Cl₆.", negativeAugment: true,
    predicate: { forbiddenPropositions: [clause(["friedel crafts", "friedel-crafts", "lewis acid", "catalyst for"])] },
    cuePredicate: { entities: [["displayed formula", "read that formula", "use what is visible"]], forbiddenPropositions: [clause(["friedel crafts", "friedel-crafts", "lewis acid", "catalyst for"])] },
    rationale: "The current proposition is already visible, so unrelated or duplicate AUGMENT is a failure while the spoken HINT remains valid.",
  },
  {
    key: "negative-augment-question-leakage",
    tags: ["represent", "question", "negative-augment-trap", "answer-leakage", "teacher-originated"],
    surface: {
      holdout: ["Predict which way equilibrium will move after heating; keep the direction hidden for now."],
      development: [["Which side will heating favour? Ask the class without showing left or right."], ["Set this question only: after temperature rises, where does equilibrium shift? Do not reveal the direction."]],
    },
    board: ["KEEP"], cue: ["SET"], cueKinds: ["QUESTION"], mode: "REPRESENT", initialActive: "Equilibrium response to temperature.", negativeAugment: true,
    predicate: { entities: [["predict", "which way", "which side", "where"]], answerLeakage: [clause(["shift left", "moves left", "favours left"]), clause(["shift right", "moves right", "favours right"])] },
    rationale: "Represent the QUESTION while forbidding domain-derived answer leakage.",
  },
  {
    key: "negative-augment-teacher-error-task",
    tags: ["task", "negative-augment-trap", "autonomous-correct", "teacher-originated", "chemistry"],
    surface: {
      holdout: ["I claim sodium chloride is covalent; your task is to identify the error yourselves."],
      development: [["Suppose I say NaCl uses covalent bonding. Find the mistake without me correcting it."], ["Work out what is wrong with the statement that sodium chloride is covalent."]],
    },
    board: ["KEEP"], cue: ["SET"], cueKinds: ["TASK"], mode: "REPRESENT", initialActive: null, negativeAugment: true,
    predicate: { entities: [["identify the error", "find the mistake", "work out what is wrong"]], answerLeakage: [clause(["sodium chloride", "nacl"], "ionic")] },
    rationale: "False teacher content stays off Board, but the explicit learner TASK is represented without leaking the correction.",
  },
];

const defaultSafety = [
  "no_correct", "no_initiate", "accepted_non_keep_current_trigger", "exact_quotes", "no_answer_leakage",
  "checkpoint_consumed_or_pending", "no_duplicate_consumption", "replay_equal", "no_normal_transcript",
];

function historyEvents(id: string, seed: Scenario): LessonEvent[] {
  const events: LessonEvent[] = [{
    schemaVersion: LESSON_EVENT_SCHEMA_VERSION, type: "lesson.started", eventId: `${id}-start`, sessionId: id,
    sequence: 1, timestamp: "2026-09-04T00:00:00.000Z",
  }];
  let sequence = 2;
  let boardRevision = 0;
  let cueRevision = 0;
  const append = (text: string, boardText: string | null, retainPrevious: boolean, cue?: Scenario["initialCue"]) => {
    const checkpointId = `${id}-history-${sequence}`;
    const acceptedId = `${id}-history-step-${sequence}`;
    const ref = { checkpointId, quote: text };
    events.push({
      schemaVersion: LESSON_EVENT_SCHEMA_VERSION, type: "evidence.checkpoint_committed", eventId: `${id}-history-event-${sequence}`,
      sessionId: id, sequence, timestamp: `2026-09-04T00:00:0${sequence}.000Z`,
      checkpoint: { checkpointId, lessonSequence: sequence - 1, speechRunId: `${id}-history-run`, startMs: sequence * 1000, endMs: sequence * 1000 + 900, text, sourceFinalIds: [`${id}-history-final-${sequence}`], warnings: [] },
      grounding: { checkpointId, canonicalSpanIds: [{ spanId: `${id}-history-span-${sequence}`, spanRevision: 1 }], words: [], providerEvidence: [{ providerFinalId: `${id}-history-final-${sequence}` }] },
    });
    sequence += 1;
    events.push({
      schemaVersion: LESSON_EVENT_SCHEMA_VERSION, type: "interpretation.step_accepted", eventId: `${id}-history-accepted-${sequence}`,
      sessionId: id, sequence,
      step: {
        interpretationId: acceptedId, requestId: `${id}-history-request`, stepIndex: 0, consumesCheckpointIds: [checkpointId],
        baseBoardRevision: boardRevision, baseCueRevision: cueRevision,
        boardDelta: boardText === null
          ? { action: "KEEP", reason: "no_board_value" }
          : { action: "SET_ACTIVE", contribution: { mode: "REPRESENT", content: { kind: "TEXT", text: boardText }, provenance: { basis: "SPEECH", speechRefs: [ref] } }, continuity: "same_thread", retainPrevious },
        cueDelta: cue
          ? { action: "SET", cueKind: cue.kind, contribution: { mode: "REPRESENT", content: cue.content, provenance: { basis: "SPEECH", speechRefs: [ref] } } }
          : { action: "KEEP" },
        evidenceRefs: [ref], warnings: [], model: "frozen-corpus", policyVersion: ALPHA_CORE_P4.policyVersion,
        acceptedAt: `2026-09-04T00:00:0${sequence}.000Z`,
      },
    });
    sequence += 1;
    if (boardText !== null) boardRevision += 1;
    if (cue) cueRevision += 1;
  };
  if (seed.initialRetained) append(`Earlier statement: ${seed.initialRetained}`, seed.initialRetained, false);
  const active = seed.initialActive === undefined ? "Baseline teaching point." : seed.initialActive;
  if (active !== null || seed.initialCue) append(`${active ?? "No Board point."} ${seed.initialCue?.content ?? ""}`.trim(), active, Boolean(seed.initialRetained), seed.initialCue);
  return events;
}

function checkpoints(id: string, texts: string[]): CompactEvidenceCheckpoint[] {
  return texts.map((text, index) => ({
    checkpointId: `checkpoint-${id}-run-${id}-current-${index + 1}-1`, lessonSequence: 20 + index,
    speechRunId: `${id}-run`, startMs: 20_000 + index * 2_000, endMs: 21_500 + index * 2_000,
    text, sourceFinalIds: [`${id}-current-final-${index + 1}`], warnings: [],
  }));
}

function finalGold(seed: Scenario, current: CompactEvidenceCheckpoint[], initial: ReturnType<typeof replayLessonEvents>["state"], profile: "core" | "augment"): V2ProfileGold {
  const isCoreAugmentCase = Boolean(seed.mustAugment && profile === "core");
  const board = seed.board;
  const cue = seed.cue ?? seed.board.map(() => "KEEP" as const);
  const cueKinds = seed.cueKinds ?? cue.map((action) => action === "SET" ? "NOTE" : null);
  const lastBoard = board.at(-1)!;
  const lastCue = cue.at(-1)!;
  const active = board.includes("SET_ACTIVE")
    ? isCoreAugmentCase ? seed.corePredicate ?? null : seed.activePredicate ?? seed.predicate ?? null
    : "INITIAL";
  const support = board.includes("SET_ACTIVE")
    ? seed.supportPredicates ?? []
    : board.includes("ADD_SUPPORT")
      ? seed.supportPredicates ?? (seed.predicate ? [seed.predicate] : [])
      : "INITIAL";
  const retained = board.includes("SET_ACTIVE") ? [] : "INITIAL";
  const cueFinal = lastCue === "RESOLVE_CURRENT"
    ? null
    : cue.includes("SET")
      ? { kind: cueKinds[cue.map((value) => value === "SET").lastIndexOf(true)] ?? cueKinds.find(Boolean) ?? "NOTE", content: seed.cuePredicate ?? seed.predicate ?? entities("teaching cue") }
      : "INITIAL";
  const nonKeepIndexes = board.map((action, index) => action !== "KEEP" || cue[index] !== "KEEP" ? index : -1).filter((index) => index >= 0);
  const allowedContributionModes: ContributionMode[] = isCoreAugmentCase
    ? ["REPRESENT"]
    : seed.mode ? [seed.mode]
      : seed.mustAugment ? ["AUGMENT"]
        : seed.negativeAugment && seed.mode ? [seed.mode]
          : [];
  return {
    expectedBoardActions: board,
    expectedCueActions: cue,
    expectedCueKinds: cueKinds,
    allowedContributionModes,
    ...(seed.mustAugment && profile === "augment" ? { allowedProvenanceBases: ["DOMAIN_KNOWLEDGE", "STATE_AND_DOMAIN_KNOWLEDGE"] } : {}),
    requiredCurrentTriggerCheckpointIds: nonKeepIndexes.map((index) => current[index]!.checkpointId),
    ...(seed.continuity ? { expectedContinuity: seed.continuity } : {}),
    ...(seed.invalidations ? { expectedInvalidations: seed.invalidations } : {}),
    finalState: {
      boardActive: active,
      support,
      retained,
      cue: cueFinal,
    },
    semantic: isCoreAugmentCase ? seed.corePredicate : seed.predicate,
    mustAugment: Boolean(seed.mustAugment && profile === "augment"),
  };
}

function makeCase(seed: Scenario, split: "development" | "holdout", variant: number): SemanticCorpusCaseV2 {
  const suffix = split === "holdout" ? "H" : `D${variant + 1}`;
  const ordinal = String(scenarios.indexOf(seed) + 1).padStart(2, "0");
  const id = `SEM2-${suffix}-${ordinal}`;
  const texts = split === "holdout" ? seed.surface.holdout : seed.surface.development[variant]!;
  const initialLessonEvents = historyEvents(id, seed);
  const initial = replayLessonEvents(initialLessonEvents).state;
  const orderedNewCheckpoints = checkpoints(id, texts);
  const designatedBatches = orderedNewCheckpoints.map((checkpoint) => [checkpoint.checkpointId]);
  return {
    id, split, scenario: seed.key, pairedScenario: seed.key, tags: seed.tags,
    risk: seed.risk ?? "critical", initialLessonEvents, expectedInitialState: initial,
    orderedNewCheckpoints, designatedBatches,
    goldByProfile: {
      core: finalGold(seed, orderedNewCheckpoints, initial, "core"),
      augment: finalGold(seed, orderedNewCheckpoints, initial, "augment"),
    },
    safetyAssertions: [...new Set([...defaultSafety, ...seed.tags])],
    rationale: seed.rationale,
  };
}

const cases = [
  ...scenarios.flatMap((scenario) => [makeCase(scenario, "development", 0), makeCase(scenario, "development", 1)]),
  ...scenarios.map((scenario) => makeCase(scenario, "holdout", 0)),
];
const jsonl = `${cases.map((item) => JSON.stringify(item)).join("\n")}\n`;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(root, "resources/semantics/v2");
mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, "alpha-sequences.jsonl"), jsonl);
const profileManifest = (profile: typeof ALPHA_CORE_P4 | typeof ALPHA_AUGMENT_CANDIDATE_P4) => {
  const contract = teachingProviderContract(profile);
  return {
    profileVersion: profile.id, policyVersion: profile.policyVersion,
    policyDigest: persistedAuditDigest(contract.systemPolicy), schemaDigest: persistedAuditDigest(contract.text.format),
  };
};
const scenarioPairs = Object.fromEntries(scenarios.map((scenario) => [scenario.key, {
  development: cases.filter((item) => item.scenario === scenario.key && item.split === "development").map((item) => item.id),
  holdout: cases.filter((item) => item.scenario === scenario.key && item.split === "holdout").map((item) => item.id),
}]));
const categoryCounts = Object.fromEntries([...new Set(cases.flatMap((item) => item.tags))].sort().map((tag) => [tag, cases.filter((item) => item.tags.includes(tag)).length]));
const manifest = {
  corpusVersion: "alpha-semantics-corpus-v2", evaluatorVersion: "alpha-semantics-evaluator-v2",
  caseCount: cases.length,
  splitMembership: {
    development: cases.filter((item) => item.split === "development").map((item) => item.id),
    holdout: cases.filter((item) => item.split === "holdout").map((item) => item.id),
  },
  scenarioPairs, categoryCounts, fileSha256: createHash("sha256").update(jsonl).digest("hex"),
  core: profileManifest(ALPHA_CORE_P4), augment: profileManifest(ALPHA_AUGMENT_CANDIDATE_P4),
  creationTimestamp: "2026-09-04T00:00:00.000Z",
};
writeFileSync(resolve(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${cases.length} v2 cases (40 development / 20 holdout) sha256=${manifest.fileSha256}`);
