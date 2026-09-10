import type {
  Core,
  CoreTeachingState,
  Provenance,
  SemanticReference,
} from "../lesson-stream/core/contracts.ts";
import type {
  LearnerProjection,
  LearnerProjectionFixture,
  ProjectionTransition,
  RepresentationIntent,
  WorkBlock,
} from "./contracts.ts";

type CoreSeed = {
  id: string;
  objects: Array<[id: string, text: string]>;
  relations?: Array<[id: string, text: string, from: string, to: string]>;
  supports?: Array<[id: string, text: string, target?: string]>;
};

const speech = (id: string, quote: string) => ({ checkpointId: `fixture:${id}`, quote });
const provenance = (id: string, quote = id): Provenance => ({ speechRefs: [speech(id, quote)], stateRefs: [] });

function core(seed: CoreSeed): Core {
  return {
    id: seed.id,
    provenance: provenance(`${seed.id}:core`, seed.id),
    objects: Object.fromEntries(seed.objects.map(([id, text]) => [id, {
      id, status: "valid" as const, value: { text, provenance: provenance(`${seed.id}:${id}`, text) },
    }])),
    relations: Object.fromEntries((seed.relations ?? []).map(([id, text, fromObjectId, toObjectId]) => [id, {
      id, status: "valid" as const,
      value: { text, fromObjectId, toObjectId, provenance: provenance(`${seed.id}:${id}`, text) },
    }])),
    supports: Object.fromEntries((seed.supports ?? []).map(([id, text, target]) => [id, {
      id, status: "valid" as const,
      value: {
        text,
        provenance: provenance(`${seed.id}:${id}`, text),
        target: target ? { kind: "OBJECT" as const, coreId: seed.id, id: target } : { kind: "CORE" as const, id: seed.id },
      },
    }])),
  };
}

function state(seeds: CoreSeed[], currentCoreId: string): CoreTeachingState {
  return {
    sessionId: `m4-cross:${currentCoreId}`,
    processedThroughSequence: 1,
    knowledge: { revision: 1, currentCoreId, cores: Object.fromEntries(seeds.map(seed => [seed.id, core(seed)])) },
    cue: { revision: 0 },
  };
}

const O = (coreId: string, id: string): SemanticReference => ({ kind: "OBJECT", coreId, id });
const R = (coreId: string, id: string): SemanticReference => ({ kind: "RELATION", coreId, id });
const C = (id: string): SemanticReference => ({ kind: "CORE", id });

function projection(
  teachingState: CoreTeachingState,
  values: {
    anchor?: SemanticReference;
    emphasis?: SemanticReference[];
    context?: SemanticReference[];
    representations?: RepresentationIntent[];
    work?: WorkBlock[];
    transition: ProjectionTransition;
    projector: LearnerProjection["projector"];
  },
): LearnerProjection {
  return {
    attention: {
      ...(values.anchor ? { anchor: values.anchor } : {}),
      emphasis: values.emphasis ?? [],
      context: values.context ?? [],
      support: [],
      representations: values.representations ?? [],
    },
    ...(values.work?.length ? { workSurface: { lifecycle: "EPHEMERAL" as const, blocks: values.work } } : {}),
    transition: values.transition,
    projector: values.projector,
    parkedCoreIds: Object.keys(teachingState.knowledge.cores).filter(id => id !== teachingState.knowledge.currentCoreId),
  };
}

const baseInput = (teachingState: CoreTeachingState) => ({
  state: teachingState,
  recentChanges: [],
  presentationMode: "presentationless" as const,
  viewport: { width: 1280, height: 720 },
});

const numericalRoots = state([{
  id: "numerical-roots",
  objects: [
    ["equation", "A root is a value for which the function is zero."],
    ["sign-change", "A sign change across an interval can locate a root approximately."],
    ["iteration", "An iterative procedure can refine an approximate root."],
  ],
  relations: [["root-refinement", "A located interval provides the starting point for refinement.", "sign-change", "iteration"]],
}], "numerical-roots");

const trigGraphs = state([{
  id: "trig-graphs",
  objects: [
    ["base-sine", "The sine function is periodic."],
    ["transformed-sine", "Parameters change the amplitude, period and vertical position of a sine graph."],
    ["equivalent-form", "A trigonometric expression can have an equivalent transformed form."],
  ],
  relations: [["transform-link", "Graph transformations connect the base function to the transformed function.", "base-sine", "transformed-sine"]],
}], "trig-graphs");

const stationaryWaves = state([{
  id: "stationary-waves",
  objects: [
    ["node", "A node is a position of minimum displacement in a stationary wave."],
    ["antinode", "An antinode is a position of maximum displacement in a stationary wave."],
    ["wavelength", "Adjacent nodes are separated by half a wavelength."],
  ],
  relations: [["node-wavelength", "Node spacing can be used to infer wavelength.", "node", "wavelength"]],
}], "stationary-waves");

const youngModulus = state([{
  id: "young-modulus",
  objects: [
    ["stress", "Stress is force per unit cross-sectional area."],
    ["strain", "Strain is extension divided by original length."],
    ["young-modulus", "Young modulus is the ratio of stress to strain in the linear elastic region."],
  ],
  relations: [["modulus-ratio", "Young modulus relates stress to strain.", "stress", "young-modulus"]],
}], "young-modulus");

const microscopy = state([{
  id: "microscopy",
  objects: [
    ["light-microscope", "A light microscope forms a magnified image of cellular material."],
    ["cell-structures", "Visible cellular structures can be identified from slides or photomicrographs."],
    ["scientific-drawing", "A scientific drawing records observed structures using disciplined conventions."],
  ],
  relations: [["observe-draw", "Observed structures provide the basis for a scientific drawing.", "cell-structures", "scientific-drawing"]],
}], "microscopy");

const mutations = state([{
  id: "mutations",
  objects: [
    ["substitution", "A base substitution replaces one nucleotide with another."],
    ["insertion-deletion", "Insertion or deletion can alter the reading frame."],
    ["protein-effect", "A DNA sequence change can alter the resulting polypeptide."],
  ],
  relations: [
    ["substitution-effect", "A substitution may or may not change the encoded amino acid.", "substitution", "protein-effect"],
    ["frameshift-effect", "Insertion or deletion can change downstream codons.", "insertion-deletion", "protein-effect"],
  ],
}], "mutations");

const algorithmTrace = state([{
  id: "algorithm-trace",
  objects: [
    ["algorithm", "An algorithm specifies an ordered method for solving a problem."],
    ["loop-state", "A loop updates program state across repeated iterations."],
    ["trace", "A dry run records variable values as execution proceeds."],
  ],
  relations: [["trace-loop", "Tracing exposes how loop state changes on each iteration.", "loop-state", "trace"]],
}], "algorithm-trace");

const abstraction = state([{
  id: "abstraction",
  objects: [
    ["real-world", "A real-world system contains more detail than a computational model normally represents."],
    ["model", "Abstraction retains features relevant to the computational purpose."],
    ["omission", "Irrelevant detail is intentionally omitted from an abstraction."],
  ],
  relations: [["abstraction-link", "The model is produced by selecting relevant features and omitting others.", "real-world", "model"]],
}], "abstraction");

const taxIncidence = state([{
  id: "tax-incidence",
  objects: [
    ["demand", "Demand relates price to quantity demanded, other things equal."],
    ["elasticity", "Elasticity affects how strongly quantity responds to price."],
    ["tax", "An indirect tax changes the relationship between market price and producer receipts."],
  ],
  relations: [["elasticity-incidence", "Demand elasticity affects how the burden of a tax is shared.", "elasticity", "tax"]],
}], "tax-incidence");

const policyEvaluation = state([{
  id: "policy-evaluation",
  objects: [
    ["efficiency", "A policy can be evaluated by its effects on resource allocation and incentives."],
    ["equity", "A policy can be evaluated by how costs and benefits are distributed."],
    ["context", "The effectiveness of policy depends on economic context and assumptions."],
  ],
  relations: [["evaluation-balance", "A judgement may balance efficiency, equity and contextual constraints.", "efficiency", "equity"]],
}], "policy-evaluation");

const emancipation = state([{
  id: "emancipation",
  objects: [
    ["proclamation", "The Emancipation Proclamation changed the legal and political context of the Civil War."],
    ["interpretation-a", "One interpretation emphasises its military and diplomatic significance."],
    ["interpretation-b", "Another interpretation emphasises its limits and uneven immediate effects."],
  ],
  relations: [
    ["view-a", "Interpretation A evaluates the significance of the proclamation from one perspective.", "proclamation", "interpretation-a"],
    ["view-b", "Interpretation B evaluates the significance of the proclamation from another perspective.", "proclamation", "interpretation-b"],
  ],
}], "emancipation");

const civilWarTimeline = state([{
  id: "civil-war",
  objects: [
    ["turning-points", "Military and political turning points changed the course of the Civil War."],
    ["strategy", "Union and Confederate strategies changed during the conflict."],
    ["duration", "The interaction of military, political and social factors helps explain why the war lasted four years."],
  ],
  relations: [["timeline-explanation", "Chronology supports explanation but does not by itself establish causation.", "turning-points", "duration"]],
}], "civil-war");

const textComparison = state([{
  id: "text-comparison",
  objects: [
    ["purpose", "Purpose shapes choices of language, form and structure."],
    ["audience", "Audience affects register and stylistic choices."],
    ["style", "Style emerges from patterned linguistic choices in a text."],
  ],
  relations: [["purpose-style", "Stylistic choices can be analysed in relation to purpose.", "purpose", "style"]],
}], "text-comparison");

const reflectiveCommentary = state([{
  id: "reflective-commentary",
  objects: [
    ["linguistic-choice", "A reflective commentary explains why particular linguistic choices were made."],
    ["effect", "Commentary links textual choices to their effects on audience and purpose."],
    ["evidence", "Claims in commentary should be supported with references to the learner's own text."],
  ],
  relations: [["choice-effect", "A commentary connects a textual choice with its intended effect.", "linguistic-choice", "effect"]],
}], "reflective-commentary");

const settlement = state([{
  id: "settlement",
  objects: [
    ["rural", "Rural settlements tend to have characteristic land-use, population and accessibility patterns."],
    ["urban", "Urban settlements tend to have characteristic density, functions and built environments."],
    ["classification", "Settlement characteristics can be compared without treating rural and urban as a simple binary in every case."],
  ],
  relations: [["rural-urban", "Observed characteristics support comparison of rural and urban environments.", "rural", "urban"]],
}], "settlement");

const tropicalBiomes = state([{
  id: "tropical-biomes",
  objects: [
    ["rainforest", "Tropical rainforest is associated with humid low-latitude climates."],
    ["savanna", "Savanna environments have a strongly seasonal rainfall regime."],
    ["distribution", "Biome distribution is related to latitude, climate and other environmental controls."],
  ],
  relations: [["biome-distribution", "Climate patterns help explain the global distribution of tropical biomes.", "distribution", "rainforest"]],
}], "tropical-biomes");

export const M4A_CROSS_DISCIPLINE_FIXTURES: LearnerProjectionFixture[] = [
  {
    id: "math-numerical-root-graph-to-iteration",
    source: { family: "CAMBRIDGE", subject: "MATHEMATICS", title: "9709 numerical solution of equations", url: "https://learning.cambridgeinternational.org/classroom/pluginfile.php/167993/mod_resource/content/2/9709_y20-22_sw_Pure2_v1.pdf" },
    sequenceSummary: "A graph plotter first makes a sign change and approximate root visible; learners then refine the root numerically.",
    input: { ...baseInput(numericalRoots), recentChanges: [{ ref: O("numerical-roots", "iteration"), kind: "ADDED" }] },
    expected: projection(numericalRoots, {
      anchor: O("numerical-roots", "equation"), context: [O("numerical-roots", "sign-change")], emphasis: [R("numerical-roots", "root-refinement")],
      representations: [{ id: "root-plot", kind: "PLOT", role: "dominant", target: O("numerical-roots", "equation") }],
      work: [{ id: "root-iteration", kind: "TABLE", status: "IN_PROGRESS", semanticRefs: [O("numerical-roots", "iteration")] }],
      transition: { knowledge: "ADVANCE", framing: "FOCUS", representation: "SWITCH" },
      projector: "FOLLOW_ATTENTION",
    }),
    mustNot: ["PERSIST_WORK_AS_KNOWLEDGE", "SHOW_ALL_AVAILABLE_REPRESENTATIONS", "WRITE_VISUAL_STATE_TO_SEMANTICS"],
  },
  {
    id: "math-trig-graph-comparison",
    source: { family: "CAMBRIDGE", subject: "MATHEMATICS", title: "9709 trigonometry teaching pack", url: "https://learning.cambridgeinternational.org/classroom/pluginfile.php/164646/mod_resource/content/4/9709_Teaching_Pack_2_3_Trigonometry_v1.pdf" },
    sequenceSummary: "Learners compare a base trigonometric graph with transformed forms, discuss similarities and differences, then sketch and exchange examples.",
    input: baseInput(trigGraphs),
    expected: projection(trigGraphs, {
      anchor: O("trig-graphs", "transformed-sine"), emphasis: [O("trig-graphs", "base-sine")], context: [O("trig-graphs", "equivalent-form")],
      representations: [{ id: "trig-comparison", kind: "PLOT", role: "dominant", target: O("trig-graphs", "transformed-sine") }],
      work: [{ id: "learner-trig-sketch", kind: "PLOT", status: "IN_PROGRESS", semanticRefs: [O("trig-graphs", "transformed-sine")] }],
      transition: { knowledge: "PRESERVE", framing: "COMPARE", representation: "KEEP" },
      projector: "REFRAME_ATTENTION",
    }),
    mustNot: ["PERSIST_WORK_AS_KNOWLEDGE", "RELAYOUT_ESTABLISHED_KNOWLEDGE", "SHOW_ALL_AVAILABLE_REPRESENTATIONS"],
  },
  {
    id: "physics-stationary-wave-practical",
    source: { family: "CAMBRIDGE", subject: "PHYSICS", title: "9702 investigating stationary waves", url: "https://learning.cambridgeinternational.org/classroom/course/view.php?id=3139" },
    sequenceSummary: "Learners inspect a stationary-wave setup, identify nodes and antinodes, record measurements and infer wavelength.",
    input: baseInput(stationaryWaves),
    expected: projection(stationaryWaves, {
      anchor: O("stationary-waves", "node"), context: [O("stationary-waves", "antinode")], emphasis: [R("stationary-waves", "node-wavelength")],
      representations: [
        { id: "stationary-apparatus", kind: "APPARATUS", role: "dominant", target: C("stationary-waves") },
        { id: "stationary-profile", kind: "PLOT", role: "companion", target: O("stationary-waves", "wavelength") },
      ],
      work: [{ id: "node-measurements", kind: "TABLE", status: "IN_PROGRESS", semanticRefs: [O("stationary-waves", "wavelength")] }],
      transition: { knowledge: "PRESERVE", framing: "FOCUS", representation: "PAIR" },
      projector: "PRESERVE_VIEW",
    }),
    mustNot: ["PERSIST_WORK_AS_KNOWLEDGE", "SHOW_ALL_AVAILABLE_REPRESENTATIONS", "RELAYOUT_ESTABLISHED_KNOWLEDGE"],
  },
  {
    id: "physics-young-modulus-data-to-plot",
    source: { family: "CAMBRIDGE", subject: "PHYSICS", title: "9702 determining Young modulus", url: "https://learning.cambridgeinternational.org/classroom/course/view.php?id=3139" },
    sequenceSummary: "Learners measure force and extension, convert results into stress and strain, plot the relationship and determine Young modulus.",
    input: { ...baseInput(youngModulus), recentChanges: [{ ref: O("young-modulus", "young-modulus"), kind: "ADDED" }] },
    expected: projection(youngModulus, {
      anchor: O("young-modulus", "young-modulus"), context: [O("young-modulus", "stress"), O("young-modulus", "strain")],
      representations: [{ id: "stress-strain-plot", kind: "PLOT", role: "dominant", target: O("young-modulus", "young-modulus") }],
      work: [{ id: "extension-data", kind: "TABLE", status: "SETTLED", semanticRefs: [O("young-modulus", "stress"), O("young-modulus", "strain")] }],
      transition: { knowledge: "ADVANCE", framing: "FOCUS", representation: "SWITCH" },
      projector: "FOLLOW_ATTENTION",
    }),
    mustNot: ["PERSIST_WORK_AS_KNOWLEDGE", "SHOW_ALL_AVAILABLE_REPRESENTATIONS", "WRITE_VISUAL_STATE_TO_SEMANTICS"],
  },
  {
    id: "biology-microscopy-image-to-drawing",
    source: { family: "CAMBRIDGE", subject: "BIOLOGY", title: "9700 microscope in cell studies", url: "https://studylib.net/doc/27339515/9700-scheme-of-work--for-examination-from-2022-" },
    sequenceSummary: "Learners identify microscope components, inspect slides or photomicrographs and produce scientific drawings from observation.",
    input: baseInput(microscopy),
    expected: projection(microscopy, {
      anchor: O("microscopy", "cell-structures"), context: [O("microscopy", "light-microscope")],
      representations: [
        { id: "cell-micrograph", kind: "IMAGE", role: "dominant", target: O("microscopy", "cell-structures") },
        { id: "drawing-conventions", kind: "DIAGRAM", role: "companion", target: O("microscopy", "scientific-drawing") },
      ],
      work: [{ id: "learner-cell-drawing", kind: "IMAGE", status: "IN_PROGRESS", semanticRefs: [O("microscopy", "scientific-drawing")] }],
      transition: { knowledge: "PRESERVE", framing: "FOCUS", representation: "PAIR" },
      projector: "PRESERVE_VIEW",
    }),
    mustNot: ["PERSIST_WORK_AS_KNOWLEDGE", "SHOW_ALL_AVAILABLE_REPRESENTATIONS", "WRITE_VISUAL_STATE_TO_SEMANTICS"],
  },
  {
    id: "biology-mutation-flow-comparison",
    source: { family: "CAMBRIDGE", subject: "BIOLOGY", title: "9700 mutation flow diagrams", url: "https://studylib.net/doc/25967531/9700-sow-9700-sow-exam-2022" },
    sequenceSummary: "Learners compare substitution with insertion/deletion and construct flow diagrams linking DNA change to protein consequences.",
    input: baseInput(mutations),
    expected: projection(mutations, {
      anchor: O("mutations", "protein-effect"), emphasis: [O("mutations", "substitution"), O("mutations", "insertion-deletion")],
      representations: [{ id: "mutation-flow", kind: "DIAGRAM", role: "dominant", target: O("mutations", "protein-effect") }],
      work: [{ id: "learner-mutation-flow", kind: "DIAGRAM", status: "IN_PROGRESS", semanticRefs: [O("mutations", "protein-effect")] }],
      transition: { knowledge: "PRESERVE", framing: "COMPARE", representation: "KEEP" },
      projector: "REFRAME_ATTENTION",
    }),
    mustNot: ["PERSIST_WORK_AS_KNOWLEDGE", "RELAYOUT_ESTABLISHED_KNOWLEDGE", "SHOW_ALL_AVAILABLE_REPRESENTATIONS"],
  },
  {
    id: "cs-algorithm-code-dry-run",
    source: { family: "CAMBRIDGE", subject: "COMPUTER_SCIENCE", title: "9618 algorithm design and programming", url: "https://learning.cambridgeinternational.org/classroom/course/section.php?id=36941" },
    sequenceSummary: "A code or pseudocode fragment remains visible while learners dry-run it and record variable state across iterations.",
    input: baseInput(algorithmTrace),
    expected: projection(algorithmTrace, {
      anchor: O("algorithm-trace", "algorithm"), context: [O("algorithm-trace", "loop-state")], emphasis: [R("algorithm-trace", "trace-loop")],
      representations: [{ id: "algorithm-code", kind: "CODE", role: "dominant", target: O("algorithm-trace", "algorithm") }],
      work: [{ id: "dry-run-table", kind: "TABLE", status: "IN_PROGRESS", semanticRefs: [O("algorithm-trace", "trace")] }],
      transition: { knowledge: "PRESERVE", framing: "FOCUS", representation: "KEEP" },
      projector: "PRESERVE_VIEW",
    }),
    mustNot: ["PERSIST_WORK_AS_KNOWLEDGE", "REPLACE_PRIMARY_SOURCE_WITH_SUMMARY", "WRITE_VISUAL_STATE_TO_SEMANTICS"],
  },
  {
    id: "cs-abstraction-real-world-to-model",
    source: { family: "CAMBRIDGE", subject: "COMPUTER_SCIENCE", title: "9618 computational thinking and abstraction", url: "https://www.scribd.com/document/933264402/Computer-Science-a-Level-Scheme" },
    sequenceSummary: "Learners compare a real-world system with a game or computational representation, identifying retained and deliberately omitted features.",
    input: baseInput(abstraction),
    expected: projection(abstraction, {
      anchor: O("abstraction", "model"), emphasis: [O("abstraction", "real-world"), O("abstraction", "omission")],
      representations: [
        { id: "real-world-image", kind: "IMAGE", role: "dominant", target: O("abstraction", "real-world") },
        { id: "abstract-model", kind: "DIAGRAM", role: "dominant", target: O("abstraction", "model") },
      ],
      work: [{ id: "feature-selection", kind: "TEXT", status: "IN_PROGRESS", semanticRefs: [O("abstraction", "omission")] }],
      transition: { knowledge: "PRESERVE", framing: "COMPARE", representation: "PAIR" },
      projector: "REFRAME_ATTENTION",
    }),
    mustNot: ["PERSIST_WORK_AS_KNOWLEDGE", "SHOW_ALL_AVAILABLE_REPRESENTATIONS", "WRITE_VISUAL_STATE_TO_SEMANTICS"],
  },
  {
    id: "economics-tax-elasticity-diagram",
    source: { family: "CAMBRIDGE", subject: "ECONOMICS", title: "9708 tax incidence and elasticity", url: "https://www.scribd.com/document/729288463/9708-scheme-of-work-for-examination-from-2023" },
    sequenceSummary: "Learners draw elastic and inelastic demand cases, apply a specific tax and discuss how elasticity changes incidence.",
    input: baseInput(taxIncidence),
    expected: projection(taxIncidence, {
      anchor: O("tax-incidence", "tax"), context: [O("tax-incidence", "demand")], emphasis: [O("tax-incidence", "elasticity")],
      representations: [{ id: "tax-incidence-plot", kind: "PLOT", role: "dominant", target: O("tax-incidence", "tax") }],
      work: [{ id: "learner-tax-diagram", kind: "PLOT", status: "IN_PROGRESS", semanticRefs: [O("tax-incidence", "tax"), O("tax-incidence", "elasticity")] }],
      transition: { knowledge: "PRESERVE", framing: "COMPARE", representation: "KEEP" },
      projector: "REFRAME_ATTENTION",
    }),
    mustNot: ["PERSIST_WORK_AS_KNOWLEDGE", "SHOW_ALL_AVAILABLE_REPRESENTATIONS", "RELAYOUT_ESTABLISHED_KNOWLEDGE"],
  },
  {
    id: "economics-policy-evidence-evaluation",
    source: { family: "CAMBRIDGE", subject: "ECONOMICS", title: "9708 policy evaluation and judgement", url: "https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-international-as-and-a-level-economics-9708/" },
    sequenceSummary: "Learners organise evidence for and against a policy, compare efficiency and equity effects, then make a context-dependent judgement.",
    input: baseInput(policyEvaluation),
    expected: projection(policyEvaluation, {
      anchor: O("policy-evaluation", "context"), emphasis: [O("policy-evaluation", "efficiency"), O("policy-evaluation", "equity")],
      representations: [{ id: "policy-evidence-matrix", kind: "TABLE", role: "dominant", target: C("policy-evaluation") }],
      work: [{ id: "policy-judgement", kind: "TEXT", status: "IN_PROGRESS", semanticRefs: [C("policy-evaluation")] }],
      transition: { knowledge: "PRESERVE", framing: "COMPARE", representation: "KEEP" },
      projector: "REFRAME_ATTENTION",
    }),
    mustNot: ["PERSIST_WORK_AS_KNOWLEDGE", "COLLAPSE_COMPETING_INTERPRETATIONS", "WRITE_VISUAL_STATE_TO_SEMANTICS"],
  },
  {
    id: "history-contemporary-sources-competing-interpretations",
    source: { family: "CAMBRIDGE", subject: "HISTORY", title: "9489 contemporary sources and historical interpretations", url: "https://www.scribd.com/document/606038649/9489-Scheme-of-Work-Paper-1-and-2-American-History-for-examination-from-2021" },
    sequenceSummary: "Learners compare contemporary reactions and later historical interpretations of the Emancipation Proclamation without collapsing them into one authorised reading.",
    input: baseInput(emancipation),
    expected: projection(emancipation, {
      anchor: O("emancipation", "proclamation"), emphasis: [O("emancipation", "interpretation-a"), O("emancipation", "interpretation-b")],
      representations: [
        { id: "source-a", kind: "SOURCE_TEXT", role: "dominant", target: O("emancipation", "proclamation") },
        { id: "source-b", kind: "SOURCE_TEXT", role: "dominant", target: O("emancipation", "proclamation") },
      ],
      work: [{ id: "source-comparison-notes", kind: "SOURCE_TEXT", status: "IN_PROGRESS", semanticRefs: [O("emancipation", "interpretation-a"), O("emancipation", "interpretation-b")] }],
      transition: { knowledge: "PRESERVE", framing: "COMPARE", representation: "PAIR" },
      projector: "REFRAME_ATTENTION",
    }),
    mustNot: ["COLLAPSE_COMPETING_INTERPRETATIONS", "REPLACE_PRIMARY_SOURCE_WITH_SUMMARY", "PERSIST_WORK_AS_KNOWLEDGE"],
  },
  {
    id: "history-turning-points-timeline-to-causation",
    source: { family: "CAMBRIDGE", subject: "HISTORY", title: "9489 Civil War turning points and class discussion", url: "https://www.scribd.com/document/606038649/9489-Scheme-of-Work-Paper-1-and-2-American-History-for-examination-from-2021" },
    sequenceSummary: "Groups build a timeline of turning points and changing strategies, then use it as evidence in a discussion of why the conflict lasted four years.",
    input: baseInput(civilWarTimeline),
    expected: projection(civilWarTimeline, {
      anchor: O("civil-war", "duration"), context: [O("civil-war", "strategy")], emphasis: [O("civil-war", "turning-points")],
      representations: [{ id: "civil-war-timeline", kind: "TIMELINE", role: "dominant", target: O("civil-war", "turning-points") }],
      work: [{ id: "learner-turning-point-timeline", kind: "TIMELINE", status: "SETTLED", semanticRefs: [O("civil-war", "turning-points"), O("civil-war", "strategy")] }],
      transition: { knowledge: "PRESERVE", framing: "WIDEN", representation: "KEEP" },
      projector: "REFRAME_ATTENTION",
    }),
    mustNot: ["PERSIST_WORK_AS_KNOWLEDGE", "COLLAPSE_COMPETING_INTERPRETATIONS", "SHOW_ALL_AVAILABLE_REPRESENTATIONS"],
  },
  {
    id: "english-original-rewrite-comparison",
    source: { family: "CAMBRIDGE", subject: "ENGLISH_LANGUAGE", title: "9093 original text and directed-writing comparison", url: "https://www.scribd.com/document/681727686/9093-Scheme-of-Work-for-Examination-From-2021" },
    sequenceSummary: "Learners compare an original text with a rewritten version, analysing how form, structure and language serve different purposes and audiences.",
    input: baseInput(textComparison),
    expected: projection(textComparison, {
      anchor: O("text-comparison", "style"), context: [O("text-comparison", "purpose"), O("text-comparison", "audience")],
      representations: [
        { id: "original-text", kind: "SOURCE_TEXT", role: "dominant", target: C("text-comparison") },
        { id: "rewrite", kind: "SOURCE_TEXT", role: "dominant", target: C("text-comparison") },
      ],
      work: [{ id: "comparison-annotations", kind: "TEXT", status: "IN_PROGRESS", semanticRefs: [O("text-comparison", "style")] }],
      transition: { knowledge: "PRESERVE", framing: "COMPARE", representation: "PAIR" },
      projector: "REFRAME_ATTENTION",
    }),
    mustNot: ["REPLACE_PRIMARY_SOURCE_WITH_SUMMARY", "PERSIST_WORK_AS_KNOWLEDGE", "SHOW_ALL_AVAILABLE_REPRESENTATIONS"],
  },
  {
    id: "english-reflective-commentary-on-own-writing",
    source: { family: "CAMBRIDGE", subject: "ENGLISH_LANGUAGE", title: "9093 reflective commentary", url: "https://www.scribd.com/document/681727686/9093-Scheme-of-Work-for-Examination-From-2021" },
    sequenceSummary: "Learners keep their own writing available while drafting a commentary that links specific linguistic choices to purpose, audience and effect.",
    input: baseInput(reflectiveCommentary),
    expected: projection(reflectiveCommentary, {
      anchor: O("reflective-commentary", "linguistic-choice"), context: [O("reflective-commentary", "effect"), O("reflective-commentary", "evidence")],
      representations: [{ id: "learner-source-text", kind: "SOURCE_TEXT", role: "dominant", target: C("reflective-commentary") }],
      work: [{ id: "commentary-draft", kind: "TEXT", status: "IN_PROGRESS", semanticRefs: [C("reflective-commentary")] }],
      transition: { knowledge: "PRESERVE", framing: "FOCUS", representation: "KEEP" },
      projector: "PRESERVE_VIEW",
    }),
    mustNot: ["REPLACE_PRIMARY_SOURCE_WITH_SUMMARY", "PERSIST_WORK_AS_KNOWLEDGE", "WRITE_VISUAL_STATE_TO_SEMANTICS"],
  },
  {
    id: "geography-rural-urban-image-comparison",
    source: { family: "CAMBRIDGE", subject: "GEOGRAPHY", title: "9696 rural and urban settlement introduction", url: "https://www.scribd.com/document/619775429/Geography-Scheme-Of-Work-9696" },
    sequenceSummary: "Learners infer rural and urban characteristics from contrasting images and build a spider diagram from observed attributes.",
    input: baseInput(settlement),
    expected: projection(settlement, {
      anchor: O("settlement", "classification"), emphasis: [O("settlement", "rural"), O("settlement", "urban")],
      representations: [
        { id: "rural-image", kind: "IMAGE", role: "dominant", target: O("settlement", "rural") },
        { id: "urban-image", kind: "IMAGE", role: "dominant", target: O("settlement", "urban") },
      ],
      work: [{ id: "settlement-spider", kind: "DIAGRAM", status: "IN_PROGRESS", semanticRefs: [C("settlement")] }],
      transition: { knowledge: "PRESERVE", framing: "COMPARE", representation: "PAIR" },
      projector: "REFRAME_ATTENTION",
    }),
    mustNot: ["PERSIST_WORK_AS_KNOWLEDGE", "SHOW_ALL_AVAILABLE_REPRESENTATIONS", "WRITE_VISUAL_STATE_TO_SEMANTICS"],
  },
  {
    id: "geography-biome-map-climate-plot",
    source: { family: "CAMBRIDGE", subject: "GEOGRAPHY", title: "9696 tropical environments: maps and climate graphs", url: "https://studylib.net/doc/26010772/9696-scheme-of-work--for-examination-from-2018-" },
    sequenceSummary: "Learners inspect world biome and climate maps, plot selected station data and connect climate characteristics with tropical biome distribution.",
    input: baseInput(tropicalBiomes),
    expected: projection(tropicalBiomes, {
      anchor: O("tropical-biomes", "distribution"), emphasis: [O("tropical-biomes", "rainforest"), O("tropical-biomes", "savanna")],
      representations: [
        { id: "biome-map", kind: "MAP", role: "dominant", target: O("tropical-biomes", "distribution") },
        { id: "climate-plot", kind: "PLOT", role: "companion", target: O("tropical-biomes", "distribution") },
      ],
      work: [{ id: "station-climate-data", kind: "TABLE", status: "SETTLED", semanticRefs: [O("tropical-biomes", "distribution")] }],
      transition: { knowledge: "PRESERVE", framing: "COMPARE", representation: "PAIR" },
      projector: "REFRAME_ATTENTION",
    }),
    mustNot: ["PERSIST_WORK_AS_KNOWLEDGE", "SHOW_ALL_AVAILABLE_REPRESENTATIONS", "WRITE_VISUAL_STATE_TO_SEMANTICS"],
  },
];
