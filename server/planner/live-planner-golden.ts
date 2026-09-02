import type { DisplayIntent, GroundedSpeechTurn, PlannerInput } from "../../src/planner/contracts.ts";

export type LivePlannerCaseFeature = "clean" | "disfluent" | "unfinished" | "repetition" | "correction" | "multi-segment" | "ambiguous-relation" | "protected" | "notation-sensitive";
export type LivePlannerExpected = { kind: DisplayIntent["kind"]; relation?: Extract<DisplayIntent, { kind: "RELATE" }>["relation"] };
export type LivePlannerGoldenCase = { id: string; segments: string[]; expected: LivePlannerExpected; features: LivePlannerCaseFeature[] };

const one = (id: string, text: string, expected: LivePlannerExpected, features: LivePlannerCaseFeature[]): LivePlannerGoldenCase => ({ id, segments: [text], expected, features });
const many = (id: string, segments: string[], expected: LivePlannerExpected, features: LivePlannerCaseFeature[]): LivePlannerGoldenCase => ({ id, segments, expected, features: [...features, "multi-segment"] });

/** Fixed live-pipeline provider screen; the full 9701 evaluation suite remains the semantic authority. */
export const LIVE_PLANNER_GOLDENS: LivePlannerGoldenCase[] = [
  one("quiet-transition", "Okay, let's move on.", { kind: "QUIET" }, ["clean"]),
  one("quiet-filler", "Um, right, so...", { kind: "QUIET" }, ["disfluent"]),
  one("quiet-unfinished", "And if we increase the...", { kind: "QUIET" }, ["unfinished"]),
  one("quiet-repetition", "The next point, the next point...", { kind: "QUIET" }, ["repetition"]),
  one("quiet-reset", "Sorry, give me a moment.", { kind: "QUIET" }, ["disfluent"]),
  many("quiet-cross-turn-filler", ["Okay.", "Right, moving on."], { kind: "QUIET" }, ["clean"]),
  one("quiet-insufficient", "And that, well, that is...", { kind: "QUIET" }, ["unfinished", "repetition"]),

  one("text-proposition", "The reaction mixture is colourless at room temperature.", { kind: "TEXT" }, ["clean"]),
  one("text-observation", "A white precipitate forms in the test tube.", { kind: "TEXT" }, ["clean"]),
  one("text-disfluent", "So the solution, um, stays blue here.", { kind: "TEXT" }, ["disfluent"]),
  one("text-correction", "This is endothermic — sorry, I mean exothermic.", { kind: "TEXT" }, ["correction"]),
  many("text-ambiguous-cause", ["The temperature is higher.", "The particles move faster."], { kind: "TEXT" }, ["ambiguous-relation"]),
  one("text-ambiguous-sequence", "Calculate the moles and use the ratio.", { kind: "TEXT" }, ["ambiguous-relation"]),
  one("text-ambiguous-contrast", "Diamond is hard and graphite is soft.", { kind: "TEXT" }, ["ambiguous-relation"]),
  many("text-useful-cross-turn", ["We added aqueous sodium hydroxide.", "A blue precipitate appeared."], { kind: "TEXT" }, ["clean"]),

  one("focus-activation-energy", "The activation energy is the minimum energy required for a successful collision.", { kind: "FOCUS" }, ["clean", "notation-sensitive"]),
  one("focus-definition", "Electronegativity is the ability of an atom to attract bonding electrons.", { kind: "FOCUS" }, ["clean"]),
  one("focus-formula", "The formula here is NH four plus.", { kind: "FOCUS" }, ["notation-sensitive"]),
  one("focus-quantity", "Standard pressure is one hundred kilopascals.", { kind: "FOCUS" }, ["notation-sensitive"]),
  one("focus-protected", "The rate-determining step is the slowest step in the mechanism.", { kind: "FOCUS" }, ["protected"]),
  one("focus-disfluent", "The key idea, really, is dynamic equilibrium.", { kind: "FOCUS" }, ["disfluent"]),
  many("focus-cross-turn", ["Now the important term.", "It is the empirical formula."], { kind: "FOCUS" }, ["clean"]),
  one("focus-repeated-anchor", "Remember, activation energy — activation energy is the threshold.", { kind: "FOCUS" }, ["repetition", "notation-sensitive"]),

  one("cause-clean", "Higher temperature causes particles to move faster.", { kind: "RELATE", relation: "cause" }, ["clean"]),
  one("cause-because", "The rate increases because collisions are more frequent.", { kind: "RELATE", relation: "cause" }, ["clean"]),
  one("cause-result", "Greater charge density results in stronger hydration.", { kind: "RELATE", relation: "cause" }, ["clean"]),
  one("cause-disfluent", "So, um, the larger surface area causes more frequent collisions.", { kind: "RELATE", relation: "cause" }, ["disfluent"]),
  many("cause-cross-turn", ["The concentration is higher.", "Therefore collisions happen more frequently."], { kind: "RELATE", relation: "cause" }, ["clean"]),
  many("cause-cross-turn-because", ["The boiling point is higher.", "That is because the intermolecular forces are stronger."], { kind: "RELATE", relation: "cause" }, ["clean"]),
  one("cause-correction", "The rate falls — sorry, it rises because more collisions are successful.", { kind: "RELATE", relation: "cause" }, ["correction"]),

  one("sequence-clean", "First calculate the number of moles, then use the mole ratio.", { kind: "RELATE", relation: "sequence" }, ["clean"]),
  one("sequence-next", "Write the half equations first; next, balance the electrons.", { kind: "RELATE", relation: "sequence" }, ["clean"]),
  one("sequence-before", "Before adding the indicator, rinse the flask with distilled water.", { kind: "RELATE", relation: "sequence" }, ["clean"]),
  one("sequence-disfluent", "First, um, find the concentration, then substitute it into the expression.", { kind: "RELATE", relation: "sequence" }, ["disfluent"]),
  many("sequence-cross-turn", ["First measure the mass.", "Then divide by the molar mass."], { kind: "RELATE", relation: "sequence" }, ["clean"]),
  many("sequence-three-turn", ["Start by writing the equation.", "Next balance the atoms.", "Finally balance the charges."], { kind: "RELATE", relation: "sequence" }, ["clean"]),
  one("sequence-repetition", "First calculate the moles — first the moles — then calculate the concentration.", { kind: "RELATE", relation: "sequence" }, ["repetition"]),

  one("contrast-whereas", "Diamond is hard, whereas graphite is soft.", { kind: "RELATE", relation: "contrast" }, ["clean"]),
  one("contrast-but", "The forward reaction is exothermic, but the reverse reaction is endothermic.", { kind: "RELATE", relation: "contrast" }, ["clean"]),
  one("contrast-higher-than", "Magnesium has a higher melting point than sodium.", { kind: "RELATE", relation: "contrast" }, ["clean"]),
  one("contrast-disfluent", "This one is acidic, um, whereas that one is basic.", { kind: "RELATE", relation: "contrast" }, ["disfluent"]),
  many("contrast-cross-turn", ["The first solution stays colourless.", "In contrast, the second turns purple."], { kind: "RELATE", relation: "contrast" }, ["clean"]),
  one("contrast-correction", "Use ethanoic acid rather than, sorry, not ethanol.", { kind: "TEXT" }, ["correction", "protected"]),

  one("transform-iodine", "Solid iodine changes to liquid iodine.", { kind: "TRANSFORM" }, ["clean"]),
  one("transform-phase", "Liquid water becomes water vapour.", { kind: "TRANSFORM" }, ["clean"]),
  one("transform-ion", "Copper two ions turn into copper metal.", { kind: "TRANSFORM" }, ["notation-sensitive"]),
  one("transform-organic", "The alkene is converted into an alcohol.", { kind: "TRANSFORM" }, ["clean"]),
  one("transform-observation", "The blue solution changes to a colourless solution.", { kind: "TRANSFORM" }, ["clean"]),
  many("transform-cross-turn", ["We start with the ammonium ion.", "It converts to ammonia."], { kind: "TRANSFORM" }, ["notation-sensitive"]),
  one("transform-disfluent", "The precipitate, um, turns into a clear solution.", { kind: "TRANSFORM" }, ["disfluent"]),
];

export function plannerInputForGolden(item: LivePlannerGoldenCase): PlannerInput {
  const recentSpeech = item.segments.map((text, segmentIndex): GroundedSpeechTurn => ({
    id: `golden:${item.id}:${segmentIndex}`,
    text,
    words: text.replace(/[.,;—]/g, "").split(/\s+/).filter(Boolean).map((word, wordIndex) => ({ text: word, startMs: wordIndex * 100, endMs: wordIndex * 100 + 80 })),
  }));
  return { recentSpeech };
}
