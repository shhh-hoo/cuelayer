import type {
  Core,
  CoreCue,
  CoreTeachingState,
  Provenance,
  SemanticReference,
} from "../lesson-stream/core/contracts.ts";
import type {
  LearnerNavigationState,
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
  supports?: Array<[id: string, text: string, targetObjectId?: string]>;
};

const speech = (id: string, quote: string) => ({ checkpointId: `fixture:${id}`, quote });
const provenance = (id: string, quote = id): Provenance => ({ speechRefs: [speech(id, quote)], stateRefs: [] });

function core(seed: CoreSeed): Core {
  return {
    id: seed.id,
    provenance: provenance(`${seed.id}:core`, seed.id),
    objects: Object.fromEntries(seed.objects.map(([id, text]) => [id, {
      id,
      status: "valid" as const,
      value: { text, provenance: provenance(`${seed.id}:${id}`, text) },
    }])),
    relations: Object.fromEntries((seed.relations ?? []).map(([id, text, fromObjectId, toObjectId]) => [id, {
      id,
      status: "valid" as const,
      value: { text, fromObjectId, toObjectId, provenance: provenance(`${seed.id}:${id}`, text) },
    }])),
    supports: Object.fromEntries((seed.supports ?? []).map(([id, text, targetObjectId]) => [id, {
      id,
      status: "valid" as const,
      value: {
        text,
        provenance: provenance(`${seed.id}:${id}`, text),
        target: targetObjectId
          ? { kind: "OBJECT" as const, coreId: seed.id, id: targetObjectId }
          : { kind: "CORE" as const, id: seed.id },
      },
    }])),
  };
}

function teacherCue(id: string, kind: CoreCue["kind"], text: string, target?: CoreCue["target"]): CoreCue {
  const evidence = speech(`${id}:cue`, text);
  return {
    id,
    kind,
    text,
    provenance: { speechRefs: [evidence], stateRefs: [] },
    ...(target ? { target } : {}),
    origin: { kind: "TEACHER", evidence },
  };
}

function state(seeds: CoreSeed[], currentCoreId: string, cue?: CoreCue): CoreTeachingState {
  return {
    sessionId: `m4-fixture:${currentCoreId}`,
    processedThroughSequence: 1,
    knowledge: {
      revision: 1,
      currentCoreId,
      cores: Object.fromEntries(seeds.map(seed => [seed.id, core(seed)])),
    },
    cue: { revision: cue ? 1 : 0, ...(cue ? { active: cue } : {}) },
  };
}

const O = (coreId: string, id: string): SemanticReference => ({ kind: "OBJECT", coreId, id });
const R = (coreId: string, id: string): SemanticReference => ({ kind: "RELATION", coreId, id });
const S = (coreId: string, id: string): SemanticReference => ({ kind: "SUPPORT", coreId, id });
const C = (id: string): SemanticReference => ({ kind: "CORE", id });

function projection(
  teachingState: CoreTeachingState,
  values: {
    anchor?: SemanticReference;
    emphasis?: SemanticReference[];
    context?: SemanticReference[];
    support?: SemanticReference[];
    representations?: RepresentationIntent[];
    cue?: LearnerProjection["attention"]["cue"];
    work?: WorkBlock[];
    transition: ProjectionTransition;
    navigation: LearnerProjection["navigation"];
  },
): LearnerProjection {
  return {
    attention: {
      ...(values.anchor ? { anchor: values.anchor } : {}),
      emphasis: values.emphasis ?? [],
      context: values.context ?? [],
      support: values.support ?? [],
      representations: values.representations ?? [],
      ...(values.cue ? { cue: values.cue } : {}),
    },
    ...(values.work?.length ? { workSurface: { lifecycle: "EPHEMERAL" as const, blocks: values.work } } : {}),
    transition: values.transition,
    navigation: values.navigation,
    parkedCoreIds: Object.keys(teachingState.knowledge.cores).filter(id => id !== teachingState.knowledge.currentCoreId),
  };
}

const follow: LearnerNavigationState = { mode: "FOLLOW_LIVE" };
const liveNavigation = { camera: "FOLLOW_ATTENTION" as const, liveReturn: "HIDDEN" as const };
const holdInspection = { camera: "PRESERVE_VIEW" as const, liveReturn: "AVAILABLE" as const };

const ionisation = state([{
  id: "ionisation",
  objects: [
    ["definition", "First ionisation energy is the energy required to remove one electron from each atom in one mole of gaseous atoms."],
    ["periodic-trend", "First ionisation energy generally changes across a period because nuclear attraction and shielding change."],
  ],
}], "ionisation");

const kinetics = state([{
  id: "kinetics",
  objects: [
    ["collision", "Reacting particles must collide effectively."],
    ["activation-energy", "Activation energy is the minimum energy associated with a successful reaction pathway."],
    ["temperature-rate", "Increasing temperature increases the fraction of particles able to react."],
  ],
  relations: [
    ["collision-ea", "Successful collisions require sufficient energy.", "collision", "activation-energy"],
    ["temperature-ea", "Temperature changes the fraction above the activation-energy threshold.", "temperature-rate", "activation-energy"],
  ],
  supports: [["rate-observation", "A rate practical supplies observations that can be plotted and interpreted.", "temperature-rate"]],
}], "kinetics");

const organic = state([{
  id: "organic-representation",
  objects: [
    ["ethene", "Ethene is an alkene whose structure can be represented in several chemically equivalent forms."],
    ["isomerism", "Different structural arrangements can represent different compounds with the same molecular formula."],
  ],
}], "organic-representation");

const equilibriumAfterTangent = state([
  {
    id: "thermodynamics",
    objects: [["delta-g", "Gibbs free-energy change is related to reaction feasibility and equilibrium."], ["entropy", "Entropy contributes to Gibbs free-energy change."]],
  },
  {
    id: "equilibrium",
    objects: [["dynamic-equilibrium", "At dynamic equilibrium forward and reverse processes continue at equal rates."], ["concentration-time", "Concentrations become constant at equilibrium while microscopic processes continue."]],
    relations: [["eq-graph", "A concentration-time representation can show approach to equilibrium.", "dynamic-equilibrium", "concentration-time"]],
  },
], "equilibrium");

const entropyQuestion = teacherCue("entropy-question", "QUESTION", "How can we account for the direction in which this change occurs?", { kind: "CORE", id: "entropy" });
const entropy = state([{
  id: "entropy",
  objects: [["entropy-change", "Entropy change describes how the dispersal of energy and matter changes."], ["probability", "The number of accessible arrangements contributes to the direction of change."]],
  relations: [["entropy-probability", "Accessible arrangements help explain entropy change.", "probability", "entropy-change"]],
}], "entropy", entropyQuestion);

const catalystTask = teacherCue("catalyst-task", "TASK", "Investigate how a catalyst changes the observed reaction rate.", { kind: "CORE", id: "catalysts" });
const catalysts = state([{
  id: "catalysts",
  objects: [["catalyst", "A catalyst increases reaction rate and is regenerated overall."], ["alternative-path", "A catalyst provides an alternative reaction pathway."], ["lower-ea", "The alternative pathway has a lower activation energy."]],
  relations: [["path-ea", "The alternative pathway lowers the activation-energy barrier.", "alternative-path", "lower-ea"]],
}], "catalysts", catalystTask);

const equilibriumQuestion = teacherCue("equilibrium-question", "QUESTION", "Which of these statements about equilibrium are defensible, and why?", { kind: "CORE", id: "equilibrium" });
const equilibriumDiscussion = state([{
  id: "equilibrium",
  objects: [["dynamic", "Dynamic equilibrium contains continuing forward and reverse processes."], ["closed-system", "A closed system is required for an equilibrium composition to be established under fixed conditions."]],
  relations: [["dynamic-closed", "The equilibrium description applies to a closed system under fixed conditions.", "dynamic", "closed-system"]],
}], "equilibrium", equilibriumQuestion);

const hess = state([{
  id: "enthalpy",
  objects: [["enthalpy-change", "An enthalpy change can be assigned to a defined chemical change."], ["hess-law", "The overall enthalpy change is independent of the route between the same initial and final states."]],
  relations: [["hess-link", "Hess's law allows an indirectly measurable enthalpy change to be constructed from other routes.", "enthalpy-change", "hess-law"]],
  supports: [["calorimetry-observation", "Experimental temperature changes provide data for enthalpy calculations.", "enthalpy-change"]],
}], "enthalpy");

const electrochem = state([{
  id: "electrochemistry",
  objects: [["half-cell", "A half-cell combines a redox couple with an electrode arrangement."], ["cell-potential", "Cell potential depends on the two half-cells and their conditions."], ["cell-notation", "Cell notation represents the components and boundaries of an electrochemical cell." ]],
  relations: [["half-cell-potential", "Combining two half-cells establishes a measurable cell potential.", "half-cell", "cell-potential"]],
}], "electrochemistry");

const calculation = state([{
  id: "concentration",
  objects: [["amount", "Amount of substance can be related to mass and molar mass."], ["concentration", "Concentration is amount of solute per unit volume of solution."], ["formula", "For molar concentration, c = n / V when volume is expressed in dm3."]],
  relations: [["formula-concentration", "The formula c = n / V operationalises molar concentration.", "concentration", "formula"]],
}], "concentration");

const concentrationQuestion = teacherCue("concentration-question", "QUESTION", "Which solution is more concentrated before we calculate it, and what evidence supports the prediction?", { kind: "CORE", id: "solutions" });
const solutions = state([{
  id: "solutions",
  objects: [["concentration", "Concentration depends on amount of solute relative to solution volume."], ["dilution", "Adding solvent changes concentration without changing the amount of solute present."]],
  relations: [["dilution-concentration", "Increasing solvent volume at fixed solute amount lowers concentration.", "dilution", "concentration"]],
}], "solutions", concentrationQuestion);

const bonding = state([{
  id: "structure-bonding",
  objects: [["ionic", "Ionic substances contain oppositely charged ions in a giant lattice."], ["simple-molecular", "Simple molecular substances contain discrete molecules with intermolecular forces between them."], ["properties", "Melting point and conductivity depend on structure and bonding." ]],
  relations: [["ionic-properties", "Ionic lattice structure contributes to characteristic physical properties.", "ionic", "properties"], ["molecular-properties", "Molecular structure contributes to characteristic physical properties.", "simple-molecular", "properties"]],
}], "structure-bonding");

const peerTask = teacherCue("complex-task", "TASK", "Use the assigned evidence to teach your peers one aspect of transition-metal complexes.", { kind: "CORE", id: "complexes" });
const complexes = state([{
  id: "complexes",
  objects: [["complex-ion", "A complex contains a central metal ion bonded to ligands."], ["ligand", "A ligand donates a lone pair to form a coordinate bond."], ["ligand-exchange", "Ligand exchange replaces one or more ligands around the central metal ion." ]],
  relations: [["ligand-complex", "Ligands coordinate to the central metal ion in a complex.", "ligand", "complex-ion"]],
}], "complexes", peerTask);

const substitution = state([{
  id: "nucleophilic-substitution",
  objects: [["nucleophile", "A nucleophile donates an electron pair."], ["electrophilic-carbon", "The carbon bonded to the leaving group is electron deficient in a polar carbon-halogen bond."], ["substitution", "Nucleophilic substitution replaces the leaving group after nucleophilic attack." ]],
  relations: [["attack", "The nucleophile attacks the electrophilic carbon.", "nucleophile", "electrophilic-carbon"], ["outcome", "Nucleophilic attack is connected to substitution of the leaving group.", "electrophilic-carbon", "substitution"]],
}], "nucleophilic-substitution");

const group2Review = state([
  {
    id: "periodicity",
    objects: [["atomic-radius", "Atomic radius generally increases down a group as additional electron shells are occupied."], ["ionisation-trend", "First ionisation energy generally decreases down Group 2." ]],
    relations: [["radius-ie", "Increasing radius and shielding weaken nuclear attraction to the outer electron.", "atomic-radius", "ionisation-trend"]],
  },
  {
    id: "group2",
    objects: [["reactivity", "Group 2 metals become more reactive down the group."], ["hydroxides", "Group 2 hydroxides show a solubility trend down the group."], ["carbonates", "Group 2 carbonates show a thermal-stability trend down the group." ]],
  },
], "group2");

export const M4A_LEARNER_PROJECTION_FIXTURES: LearnerProjectionFixture[] = [
  {
    id: "cambridge-ionisation-representation-switch",
    source: { family: "CAMBRIDGE", title: "Ionisation energy: definition to symbolic representation", url: "https://studylib.net/doc/25374364/9701-scheme-of-work--for-examination-from-2022-" },
    sequenceSummary: "A definition is established, then rewritten as a chemical equation before the lesson moves to periodic trends.",
    input: { state: ionisation, recentChanges: [{ ref: O("ionisation", "definition"), kind: "REVISED" }], presentationMode: "presentationless", navigation: follow, viewport: { width: 1280, height: 720 } },
    expected: projection(ionisation, {
      anchor: O("ionisation", "definition"),
      representations: [{ id: "ionisation-equation", kind: "CHEMICAL_EQUATION", role: "dominant", target: O("ionisation", "definition") }],
      transition: { knowledge: "PRESERVE", framing: "FOCUS", representation: "SWITCH" },
      navigation: liveNavigation,
    }),
    mustNot: ["CREATE_DUPLICATE_CORE", "SHOW_ALL_AVAILABLE_REPRESENTATIONS", "WRITE_VISUAL_STATE_TO_SEMANTICS"],
  },
  {
    id: "cambridge-kinetics-concept-graph-practical",
    source: { family: "CAMBRIDGE", title: "Kinetics: collisions, rate practical, Boltzmann and catalyst", url: "https://pdfcoffee.com/9701-scheme-of-work-for-examination-from-2022-pdf-free.html" },
    sequenceSummary: "Collision theory grows into activation energy, experimental rate evidence, a distribution graph and catalyst pathway reasoning.",
    input: { state: kinetics, recentChanges: [{ ref: O("kinetics", "temperature-rate"), kind: "ADDED" }], presentationMode: "presentationless", navigation: follow, viewport: { width: 1280, height: 720 } },
    expected: projection(kinetics, {
      anchor: O("kinetics", "temperature-rate"),
      emphasis: [R("kinetics", "temperature-ea")],
      context: [O("kinetics", "activation-energy")],
      support: [S("kinetics", "rate-observation")],
      representations: [{ id: "boltzmann", kind: "FUNCTION_PLOT", role: "dominant", target: O("kinetics", "temperature-rate") }],
      transition: { knowledge: "ADVANCE", framing: "FOCUS", representation: "SWITCH" },
      navigation: liveNavigation,
    }),
    mustNot: ["SHOW_ALL_AVAILABLE_REPRESENTATIONS", "DELETE_SUPPORT_ON_VISUAL_EVICTION", "RELAYOUT_ESTABLISHED_KNOWLEDGE"],
  },
  {
    id: "cambridge-organic-multiple-representations",
    source: { family: "CAMBRIDGE", title: "Organic chemistry: 3D, displayed and skeletal representations", url: "https://studylib.net/doc/27795999/9701-sow" },
    sequenceSummary: "Learners move between molecular models and two-dimensional structural conventions before working with isomers.",
    input: { state: organic, recentChanges: [{ ref: O("organic-representation", "ethene"), kind: "REVISED" }], presentationMode: "presentationless", navigation: follow, viewport: { width: 1024, height: 768 } },
    expected: projection(organic, {
      anchor: O("organic-representation", "ethene"),
      representations: [{ id: "ethene-structure", kind: "MOLECULE_2D", role: "dominant", target: O("organic-representation", "ethene") }],
      transition: { knowledge: "PRESERVE", framing: "FOCUS", representation: "SWITCH" },
      navigation: liveNavigation,
    }),
    mustNot: ["CREATE_DUPLICATE_CORE", "SHOW_ALL_AVAILABLE_REPRESENTATIONS", "WRITE_VISUAL_STATE_TO_SEMANTICS"],
  },
  {
    id: "mit-free-tangent-and-return",
    source: { family: "MIT_OCW", title: "Chemical equilibrium lecture: free tangent and return", url: "https://ocw.mit.edu/courses/5-111-principles-of-chemical-science-fall-2008/b1fcec8b1170537bf27a3ac6b7c1abcb_5-111F08-L19.pdf" },
    sequenceSummary: "A live lecture leaves the equilibrium mainline for a personal chemistry tangent and later returns to equilibrium graphs and Gibbs reasoning.",
    input: { state: equilibriumAfterTangent, recentChanges: [], presentationMode: "presentation-overlay", navigation: { mode: "INSPECTING_HISTORY", coreId: "thermodynamics" }, viewport: { width: 1440, height: 900 } },
    expected: projection(equilibriumAfterTangent, {
      anchor: O("equilibrium", "dynamic-equilibrium"),
      context: [O("equilibrium", "concentration-time")],
      transition: { knowledge: "PRESERVE", framing: "FOCUS", representation: "KEEP" },
      navigation: holdInspection,
    }),
    mustNot: ["CREATE_DUPLICATE_CORE", "YANK_FROM_HISTORY_INSPECTION", "TREAT_PARKED_AS_DURABLE_STATUS"],
  },
  {
    id: "rsc-entropy-dialogic-hold",
    source: { family: "RSC", title: "Why do chemical reactions happen?", url: "https://edu.rsc.org/lesson-plans/why-do-chemical-reactions-happen-16-18-years/128.article" },
    sequenceSummary: "Learners surface ideas, make predictions and discuss demonstrations before the entropy explanation is consolidated.",
    input: { state: entropy, recentChanges: [], presentationMode: "presentationless", navigation: follow, viewport: { width: 1280, height: 720 } },
    expected: projection(entropy, {
      anchor: O("entropy", "entropy-change"),
      context: [O("entropy", "probability")],
      cue: { cueId: "entropy-question", role: "dominant" },
      transition: { knowledge: "PRESERVE", framing: "FOCUS", representation: "KEEP" },
      navigation: liveNavigation,
    }),
    mustNot: ["LEAK_ANSWER_DURING_PRODUCTIVE_STRUGGLE", "INFER_LEARNER_EMOTION", "SHOW_ALL_AVAILABLE_REPRESENTATIONS"],
  },
  {
    id: "rsc-catalyst-open-practical",
    source: { family: "RSC", title: "How do catalysts affect reaction rates?", url: "https://edu.rsc.org/lesson-plans/how-do-catalysts-affect-reaction-rates-16-18-years/123.article" },
    sequenceSummary: "A catalyst concept anchors an open investigation whose procedure and observations evolve before a later debrief.",
    input: { state: catalysts, recentChanges: [], presentationMode: "presentationless", navigation: follow, viewport: { width: 1280, height: 720 } },
    expected: projection(catalysts, {
      anchor: O("catalysts", "catalyst"),
      context: [O("catalysts", "alternative-path")],
      cue: { cueId: "catalyst-task", role: "dominant" },
      work: [
        { id: "catalyst-apparatus", kind: "APPARATUS", status: "IN_PROGRESS", semanticRefs: [C("catalysts")] },
        { id: "catalyst-observation", kind: "OBSERVATION", status: "UNRESOLVED", semanticRefs: [O("catalysts", "catalyst")] },
      ],
      transition: { knowledge: "PRESERVE", framing: "FOCUS", representation: "KEEP" },
      navigation: liveNavigation,
    }),
    mustNot: ["PERSIST_WORK_AS_KNOWLEDGE", "LEAK_ANSWER_DURING_PRODUCTIVE_STRUGGLE", "WRITE_VISUAL_STATE_TO_SEMANTICS"],
  },
  {
    id: "rsc-equilibrium-misconception-discussion",
    source: { family: "RSC", title: "Equilibrium misconception discussion", url: "https://edu.rsc.org/download?ac=507684" },
    sequenceSummary: "Learners judge statements, defend them in groups and revise their thinking before the teacher resolves misconceptions.",
    input: { state: equilibriumDiscussion, recentChanges: [], presentationMode: "presentationless", navigation: follow, viewport: { width: 1180, height: 720 } },
    expected: projection(equilibriumDiscussion, {
      anchor: O("equilibrium", "dynamic"),
      context: [O("equilibrium", "closed-system")],
      cue: { cueId: "equilibrium-question", role: "dominant" },
      transition: { knowledge: "PRESERVE", framing: "FOCUS", representation: "KEEP" },
      navigation: liveNavigation,
    }),
    mustNot: ["LEAK_ANSWER_DURING_PRODUCTIVE_STRUGGLE", "INFER_LEARNER_EMOTION", "PERSIST_WORK_AS_KNOWLEDGE"],
  },
  {
    id: "rsc-hess-practical-to-cycle",
    source: { family: "RSC", title: "Hess's law through calorimetry", url: "https://edu.rsc.org/download?ac=536393" },
    sequenceSummary: "Experimental temperature changes are interpreted, then an indirectly measurable enthalpy change is represented with a Hess cycle.",
    input: { state: hess, recentChanges: [{ ref: O("enthalpy", "hess-law"), kind: "ADDED" }], presentationMode: "presentationless", navigation: follow, viewport: { width: 1280, height: 720 } },
    expected: projection(hess, {
      anchor: O("enthalpy", "hess-law"),
      emphasis: [R("enthalpy", "hess-link")],
      context: [O("enthalpy", "enthalpy-change")],
      support: [S("enthalpy", "calorimetry-observation")],
      representations: [{ id: "hess-cycle", kind: "DIAGRAM", role: "dominant", target: O("enthalpy", "hess-law") }],
      work: [{ id: "calorimetry-data", kind: "TABLE", status: "SETTLED", semanticRefs: [S("enthalpy", "calorimetry-observation")] }],
      transition: { knowledge: "ADVANCE", framing: "FOCUS", representation: "SWITCH" },
      navigation: liveNavigation,
    }),
    mustNot: ["PERSIST_WORK_AS_KNOWLEDGE", "SHOW_ALL_AVAILABLE_REPRESENTATIONS", "DELETE_SUPPORT_ON_VISUAL_EVICTION"],
  },
  {
    id: "rsc-electrochemistry-apparatus-data-symbol",
    source: { family: "RSC", title: "Electrochemical cells practical", url: "https://edu.rsc.org/practical/electrochemical-cells-practical-videos-16-18-students/4014323.article" },
    sequenceSummary: "Learners construct or inspect cells, measure potentials and connect observations to cell notation and redox representation.",
    input: { state: electrochem, recentChanges: [{ ref: O("electrochemistry", "cell-notation"), kind: "ADDED" }], presentationMode: "presentationless", navigation: follow, viewport: { width: 1280, height: 720 } },
    expected: projection(electrochem, {
      anchor: O("electrochemistry", "cell-potential"),
      context: [O("electrochemistry", "half-cell")],
      emphasis: [O("electrochemistry", "cell-notation")],
      representations: [
        { id: "cell-apparatus", kind: "APPARATUS", role: "dominant", target: O("electrochemistry", "cell-potential") },
        { id: "cell-symbol", kind: "CHEMICAL_EQUATION", role: "companion", target: O("electrochemistry", "cell-notation") },
      ],
      work: [{ id: "cell-measurements", kind: "TABLE", status: "IN_PROGRESS", semanticRefs: [O("electrochemistry", "cell-potential")] }],
      transition: { knowledge: "ADVANCE", framing: "FOCUS", representation: "PAIR" },
      navigation: liveNavigation,
    }),
    mustNot: ["PERSIST_WORK_AS_KNOWLEDGE", "SHOW_ALL_AVAILABLE_REPRESENTATIONS", "RELAYOUT_ESTABLISHED_KNOWLEDGE"],
  },
  {
    id: "rsc-worked-example-fading",
    source: { family: "RSC", title: "Worked examples for chemistry calculation scaffolding", url: "https://edu.rsc.org/ideas/worked-examples-for-assisting-student-learning/2010173.article" },
    sequenceSummary: "A fully modelled calculation is progressively faded until the learner completes the same reasoning independently.",
    input: { state: calculation, recentChanges: [], presentationMode: "presentationless", navigation: follow, viewport: { width: 1024, height: 768 } },
    expected: projection(calculation, {
      anchor: O("concentration", "formula"),
      context: [O("concentration", "concentration")],
      representations: [{ id: "concentration-formula", kind: "MATH", role: "dominant", target: O("concentration", "formula") }],
      work: [
        { id: "known-step", kind: "EQUATION", status: "SETTLED", semanticRefs: [O("concentration", "formula")] },
        { id: "learner-step", kind: "EQUATION", status: "UNRESOLVED", semanticRefs: [O("concentration", "formula")] },
      ],
      transition: { knowledge: "PRESERVE", framing: "FOCUS", representation: "KEEP" },
      navigation: liveNavigation,
    }),
    mustNot: ["PERSIST_WORK_AS_KNOWLEDGE", "SHOW_ALL_AVAILABLE_REPRESENTATIONS", "INFER_LEARNER_EMOTION"],
  },
  {
    id: "rsc-concentration-predict-test-reason",
    source: { family: "RSC", title: "Calculating and comparing solution concentrations", url: "https://edu.rsc.org/concentration-of-solutions-and-titration/calculating-and-comparing-solution-concentrations-16-18-years/120.article" },
    sequenceSummary: "Learners predict which solution is more concentrated, inspect dilution evidence and only later formalise the calculation.",
    input: { state: solutions, recentChanges: [], presentationMode: "presentationless", navigation: follow, viewport: { width: 1280, height: 720 } },
    expected: projection(solutions, {
      anchor: O("solutions", "concentration"),
      context: [O("solutions", "dilution")],
      cue: { cueId: "concentration-question", role: "dominant" },
      work: [{ id: "prediction", kind: "TEXT", status: "UNRESOLVED", semanticRefs: [O("solutions", "concentration")] }],
      transition: { knowledge: "PRESERVE", framing: "COMPARE", representation: "KEEP" },
      navigation: liveNavigation,
    }),
    mustNot: ["LEAK_ANSWER_DURING_PRODUCTIVE_STRUGGLE", "PERSIST_WORK_AS_KNOWLEDGE", "INFER_LEARNER_EMOTION"],
  },
  {
    id: "rsc-structure-bonding-collaborative-compare",
    source: { family: "RSC", title: "Linking structure, bonding and properties", url: "https://edu.rsc.org/lesson-plans/linking-structure-bonding-and-substance-properties-16-18-years/119.article" },
    sequenceSummary: "Groups match structure, bonding and property evidence, compare mappings and revise their explanations.",
    input: { state: bonding, recentChanges: [], presentationMode: "presentationless", navigation: follow, viewport: { width: 1280, height: 720 } },
    expected: projection(bonding, {
      anchor: O("structure-bonding", "properties"),
      emphasis: [O("structure-bonding", "ionic"), O("structure-bonding", "simple-molecular")],
      representations: [{ id: "structure-comparison", kind: "DIAGRAM", role: "dominant", target: O("structure-bonding", "properties") }],
      work: [{ id: "group-mapping", kind: "DIAGRAM", status: "IN_PROGRESS", semanticRefs: [O("structure-bonding", "properties")] }],
      transition: { knowledge: "PRESERVE", framing: "COMPARE", representation: "KEEP" },
      navigation: liveNavigation,
    }),
    mustNot: ["PERSIST_WORK_AS_KNOWLEDGE", "SHOW_ALL_AVAILABLE_REPRESENTATIONS", "WRITE_VISUAL_STATE_TO_SEMANTICS"],
  },
  {
    id: "rsc-transition-metal-peer-teaching",
    source: { family: "RSC", title: "Transition-metal complexes and ligand exchange", url: "https://edu.rsc.org/lesson-plans/transition-metal-complexes-and-ligand-exchange-16-18-years/116.article" },
    sequenceSummary: "Expert groups research one aspect of complexes, regroup and teach peers while the teacher facilitates rather than pre-delivering every explanation.",
    input: { state: complexes, recentChanges: [], presentationMode: "presentationless", navigation: follow, viewport: { width: 1280, height: 720 } },
    expected: projection(complexes, {
      anchor: O("complexes", "complex-ion"),
      context: [O("complexes", "ligand")],
      cue: { cueId: "complex-task", role: "dominant" },
      work: [{ id: "peer-explanation", kind: "TEXT", status: "IN_PROGRESS", semanticRefs: [C("complexes")] }],
      transition: { knowledge: "PRESERVE", framing: "FOCUS", representation: "KEEP" },
      navigation: liveNavigation,
    }),
    mustNot: ["LEAK_ANSWER_DURING_PRODUCTIVE_STRUGGLE", "PERSIST_WORK_AS_KNOWLEDGE", "INFER_LEARNER_EMOTION"],
  },
  {
    id: "rsc-nucleophilic-substitution-mechanism",
    source: { family: "RSC", title: "Nucleophilic substitution reaction mechanisms", url: "https://edu.rsc.org/lesson-plans/nucleophilic-substitution-reaction-mechanisms-16-18-years/115.article" },
    sequenceSummary: "Learners arrange mechanism stages and discuss electron movement before the mechanism is consolidated.",
    input: { state: substitution, recentChanges: [{ ref: R("nucleophilic-substitution", "attack"), kind: "ADDED" }], presentationMode: "presentationless", navigation: follow, viewport: { width: 1280, height: 720 } },
    expected: projection(substitution, {
      anchor: O("nucleophilic-substitution", "electrophilic-carbon"),
      emphasis: [R("nucleophilic-substitution", "attack")],
      context: [O("nucleophilic-substitution", "nucleophile")],
      representations: [
        { id: "mechanism-stage", kind: "DIAGRAM", role: "dominant", target: R("nucleophilic-substitution", "attack") },
        { id: "reactant-structure", kind: "MOLECULE_2D", role: "companion", target: O("nucleophilic-substitution", "electrophilic-carbon") },
      ],
      transition: { knowledge: "ADVANCE", framing: "FOCUS", representation: "PAIR" },
      navigation: liveNavigation,
    }),
    mustNot: ["SHOW_ALL_AVAILABLE_REPRESENTATIONS", "RELAYOUT_ESTABLISHED_KNOWLEDGE", "WRITE_VISUAL_STATE_TO_SEMANTICS"],
  },
  {
    id: "rsc-group2-review-widen",
    source: { family: "RSC", title: "Group 2 elements: making mind maps", url: "https://edu.rsc.org/lesson-plans/group-2-elements-making-mind-maps-16-18-years/118.article" },
    sequenceSummary: "Learners construct and peer-review a topic map, explicitly reconnecting periodic trends with Group 2 reactions and properties.",
    input: { state: group2Review, recentChanges: [], presentationMode: "presentationless", navigation: follow, viewport: { width: 1440, height: 900 } },
    expected: projection(group2Review, {
      anchor: C("group2"),
      emphasis: [O("group2", "reactivity"), O("group2", "hydroxides"), O("group2", "carbonates")],
      context: [O("periodicity", "ionisation-trend")],
      representations: [{ id: "group2-review-map", kind: "DIAGRAM", role: "dominant", target: C("group2") }],
      work: [{ id: "learner-mind-map", kind: "DIAGRAM", status: "IN_PROGRESS", semanticRefs: [C("group2"), C("periodicity")] }],
      transition: { knowledge: "PRESERVE", framing: "WIDEN", representation: "KEEP" },
      navigation: liveNavigation,
    }),
    mustNot: ["PERSIST_WORK_AS_KNOWLEDGE", "TREAT_PARKED_AS_DURABLE_STATUS", "SHOW_ALL_AVAILABLE_REPRESENTATIONS"],
  },
];
