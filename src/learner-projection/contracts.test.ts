import { describe, expect, expectTypeOf, it } from "vitest";
import {
  learnerProjectionFixtureErrors, REPRESENTATION_KINDS, WORK_BLOCK_KINDS,
  type ForbiddenProjectionBehavior, type LearnerProjection,
  type LearnerProjectionInput, type ProjectionCandidate, type ProjectionTransition, type SharedProjectorIntent,
} from "./contracts.ts";
import { M4A_CROSS_DISCIPLINE_FIXTURES } from "./cross-discipline-fixtures.ts";
import {
  M4A_GROUNDED_LEARNER_PROJECTION_FIXTURES,
  M4A_RESEARCH_LEARNER_PROJECTION_FIXTURES,
} from "./grounded-fixtures.ts";

const fixtures = M4A_GROUNDED_LEARNER_PROJECTION_FIXTURES;
const researchFixtures = M4A_RESEARCH_LEARNER_PROJECTION_FIXTURES;

describe("M4A learner projection contract fixtures", () => {
  it("uses a Chemistry foundation plus a deliberately adversarial cross-discipline corpus", () => {
    expect(fixtures).toHaveLength(31);
    expect(researchFixtures).toHaveLength(31);
    expect(M4A_CROSS_DISCIPLINE_FIXTURES).toHaveLength(16);
    expect(Object.fromEntries([...new Set(fixtures.map(fixture => fixture.source.subject))]
      .map(subject => [subject, fixtures.filter(fixture => fixture.source.subject === subject).length]))).toEqual({
      CHEMISTRY: 15, MATHEMATICS: 2, PHYSICS: 2, BIOLOGY: 2, COMPUTER_SCIENCE: 2,
      ECONOMICS: 2, HISTORY: 2, ENGLISH_LANGUAGE: 2, GEOGRAPHY: 2,
    });
    expect(new Set(fixtures.map(fixture => fixture.source.family))).toEqual(
      new Set(["CAMBRIDGE", "RSC", "MIT_OCW"]),
    );
    expect(new Set(M4A_CROSS_DISCIPLINE_FIXTURES.map(fixture => fixture.source.subject))).toEqual(new Set([
      "MATHEMATICS", "PHYSICS", "BIOLOGY", "COMPUTER_SCIENCE", "ECONOMICS", "HISTORY", "ENGLISH_LANGUAGE", "GEOGRAPHY",
    ]));
  });

  it.each(fixtures)("$id satisfies projection hard invariants", fixture => {
    expect(learnerProjectionFixtureErrors(fixture)).toEqual([]);
  });

  it("covers preserve and advance without introducing a teaching-style state machine", () => {
    const transitions = fixtures.map(fixture => fixture.expected.transition.knowledge);
    expect(new Set(transitions)).toEqual(new Set(["PRESERVE", "ADVANCE"]));

    const serialized = JSON.stringify(fixtures);
    expect(serialized).not.toContain("teachingStyle");
    expect(serialized).not.toContain('"LECTURE"');
    expect(serialized).not.toContain('"INQUIRY"');
    expect(serialized).not.toContain('"PRACTICAL"');
    expect(serialized).not.toContain('"ESSAY"');
    expect(serialized).not.toContain('"DISCUSSION"');
    expect(serialized).not.toContain('"learnerEmotion"');
  });

  it("distinguishes focused teaching, comparison and deliberate review widening", () => {
    const framing = new Set(fixtures.map(fixture => fixture.expected.transition.framing));
    expect(framing).toEqual(new Set(["FOCUS", "COMPARE", "WIDEN"]));
  });

  it("treats representation switching and paired representations as projection choices", () => {
    const representation = new Set(fixtures.map(fixture => fixture.expected.transition.representation));
    expect(representation).toEqual(new Set(["KEEP", "SWITCH", "PAIR"]));
    for (const fixture of fixtures) {
      if (fixture.expected.transition.framing !== "COMPARE") {
        expect(fixture.expected.attention.representations.filter(item => item.role === "dominant").length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("generalizes domain-native representations rather than forcing every subject into a concept graph", () => {
    const kinds = new Set(M4A_CROSS_DISCIPLINE_FIXTURES.flatMap(fixture => fixture.expected.attention.representations.map(item => item.kind)));
    for (const required of ["PLOT", "CODE", "SOURCE_TEXT", "IMAGE", "MAP", "TIMELINE"]) expect(kinds).toContain(required);
  });

  it("requires every representation and Work Surface block to come from committed-evidence candidates", () => {
    for (const fixture of fixtures) {
      const projectedIds = [
        ...fixture.expected.attention.representations.map(item => item.id),
        ...(fixture.expected.workSurface?.blocks.map(block => block.id) ?? []),
      ];
      const candidates = fixture.input.candidates ?? [];
      const candidateIds = candidates.map(candidate => candidate.id);
      const committed = new Set(fixture.input.committedEvidenceCheckpointIds ?? []);
      expect(candidateIds).toEqual(projectedIds);
      for (const candidate of candidates) {
        expect(candidate.evidenceCheckpointIds.length).toBeGreaterThan(0);
        expect(candidate.evidenceCheckpointIds.every(checkpointId => committed.has(checkpointId))).toBe(true);
      }
      if (projectedIds.length) expect(fixture.mustNot).toContain("INVENT_UNGROUNDED_SURFACE");
    }
  });

  it("rejects research expectations as executable inputs until transient surfaces are grounded", () => {
    const requiringCandidates = researchFixtures.filter(fixture =>
      fixture.expected.attention.representations.length > 0 || Boolean(fixture.expected.workSurface?.blocks.length),
    );
    expect(requiringCandidates.length).toBeGreaterThan(0);
    for (const fixture of requiringCandidates) {
      const errors = learnerProjectionFixtureErrors(fixture);
      expect(errors.some(error => error.includes("no grounded transient candidate"))).toBe(true);
    }
  });

  it("keeps calculation, practical and learner-generated work explicitly ephemeral", () => {
    const withWork = fixtures.filter(fixture => fixture.expected.workSurface);
    expect(withWork.length).toBeGreaterThanOrEqual(20);
    for (const fixture of withWork) {
      expect(fixture.expected.workSurface?.lifecycle).toBe("EPHEMERAL");
      expect(fixture.mustNot).toContain("PERSIST_WORK_AS_KNOWLEDGE");
    }
  });

  it("protects productive struggle when an unresolved learner question dominates", () => {
    const questions = fixtures.filter(fixture => {
      const cueId = fixture.expected.attention.cue?.cueId;
      return cueId && fixture.input.state.cue.active?.id === cueId && fixture.input.state.cue.active.kind === "QUESTION";
    });
    expect(questions.length).toBeGreaterThanOrEqual(3);
    for (const fixture of questions) {
      expect(fixture.expected.attention.cue?.role).toBe("dominant");
      expect(fixture.mustNot).toContain("LEAK_ANSWER_DURING_PRODUCTIVE_STRUGGLE");
    }
  });

  it("uses shared projector intent without personal navigation or return-to-live state", () => {
    expect(new Set(fixtures.map(fixture => fixture.expected.projector))).toEqual(
      new Set(["PRESERVE_VIEW", "FOLLOW_ATTENTION", "REFRAME_ATTENTION"]),
    );
    const serialized = JSON.stringify(fixtures);
    for (const superseded of ["LearnerNavigationState", "FOLLOW_LIVE", "INSPECTING_HISTORY", "liveReturn", "Live →", "YANK_FROM_HISTORY_INSPECTION"]) {
      expect(serialized).not.toContain(superseded);
    }
  });

  it("derives Parked Cores from currentCoreId rather than persisting a Parked status", () => {
    const review = fixtures.find(fixture => fixture.id === "rsc-group2-review-widen");
    expect(review?.input.state.knowledge.currentCoreId).toBe("group2");
    expect(review?.expected.parkedCoreIds).toEqual(["periodicity"]);
    expect(review?.mustNot).toContain("TREAT_PARKED_AS_DURABLE_STATUS");
  });

  it("keeps the free tangent as a hold rather than inventing a competing semantic Core", () => {
    const tangent = fixtures.find(fixture => fixture.id === "mit-free-tangent-and-return");
    expect(tangent?.expected.transition).toEqual({ knowledge: "PRESERVE", framing: "FOCUS", representation: "KEEP" });
    expect(tangent?.input.recentChanges).toEqual([]);
    expect(tangent?.input.state.knowledge.currentCoreId).toBe("equilibrium");
    expect(tangent?.expected.projector).toBe("PRESERVE_VIEW");
    expect(tangent?.expected.attention.anchor).toEqual({ kind: "OBJECT", coreId: "equilibrium", id: "dynamic-equilibrium" });
    expect(tangent?.expected.parkedCoreIds).toEqual(["thermodynamics"]);
    expect(tangent?.mustNot).toContain("CREATE_DUPLICATE_CORE");
  });

  it("allows History to compare competing interpretations without collapsing them into one answer", () => {
    const history = fixtures.find(fixture => fixture.id === "history-contemporary-sources-competing-interpretations");
    expect(history?.expected.transition.framing).toBe("COMPARE");
    expect(history?.expected.attention.emphasis).toHaveLength(2);
    expect(history?.expected.attention.context).toEqual([]);
    expect(history?.expected.attention.representations.map(item => item.role)).toEqual(["dominant", "dominant"]);
    expect(history?.mustNot).toContain("COLLAPSE_COMPETING_INTERPRETATIONS");
  });

  it("keeps primary source text visible in English rather than replacing it with an AI summary", () => {
    const english = fixtures.find(fixture => fixture.id === "english-original-rewrite-comparison");
    expect(english?.expected.attention.representations.map(item => item.kind)).toEqual(["SOURCE_TEXT", "SOURCE_TEXT"]);
    expect(english?.expected.attention.representations.map(item => item.role)).toEqual(["dominant", "dominant"]);
    expect(english?.mustNot).toContain("REPLACE_PRIMARY_SOURCE_WITH_SUMMARY");
  });

  it("keeps a Computer Science dry run as ephemeral execution state", () => {
    const cs = fixtures.find(fixture => fixture.id === "cs-algorithm-code-dry-run");
    expect(cs?.expected.attention.representations[0]?.kind).toBe("CODE");
    expect(cs?.expected.workSurface?.blocks[0]).toMatchObject({ id: "dry-run-table", kind: "TABLE", status: "IN_PROGRESS" });
    expect(cs?.mustNot).toContain("PERSIST_WORK_AS_KNOWLEDGE");
  });

  it("treats maps as content representations rather than Canvas geometry", () => {
    const geography = fixtures.find(fixture => fixture.id === "geography-biome-map-climate-plot");
    expect(geography?.expected.attention.representations.map(item => item.kind)).toEqual(["MAP", "PLOT"]);
    expect(geography?.mustNot).toContain("WRITE_VISUAL_STATE_TO_SEMANTICS");
  });
});

const copyFixture = (id = "cs-algorithm-code-dry-run") =>
  structuredClone(fixtures.find(fixture => fixture.id === id)!);

describe("M4A reviewed contract boundaries", () => {
  it("keeps exactly the reviewed knowledge, framing and projector vocabularies", () => {
    expectTypeOf<ProjectionTransition["knowledge"]>().toEqualTypeOf<"PRESERVE" | "ADVANCE">();
    expectTypeOf<ProjectionTransition["framing"]>().toEqualTypeOf<"FOCUS" | "COMPARE" | "WIDEN">();
    expectTypeOf<SharedProjectorIntent>().toEqualTypeOf<"PRESERVE_VIEW" | "FOLLOW_ATTENTION" | "REFRAME_ATTENTION">();
    expectTypeOf<Extract<keyof LearnerProjectionInput, "navigation" | "liveReturn">>().toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof LearnerProjection, "navigation" | "liveReturn">>().toEqualTypeOf<never>();
    expectTypeOf<Extract<ForbiddenProjectionBehavior, "YANK_FROM_HISTORY_INSPECTION">>().toEqualTypeOf<never>();
    expectTypeOf<ProjectionCandidate["candidateType"]>().toEqualTypeOf<"REPRESENTATION" | "WORK">();
  });

  it("uses one generic plot capability in Chemistry and across disciplines", () => {
    expect(REPRESENTATION_KINDS).toEqual([
      "TEXT", "MATH", "CHEMICAL_EQUATION", "MOLECULE_2D", "PLOT", "TABLE", "DIAGRAM",
      "APPARATUS", "CODE", "SOURCE_TEXT", "IMAGE", "MAP", "TIMELINE",
    ]);
    expect(WORK_BLOCK_KINDS).toContain("PLOT");
    expect(WORK_BLOCK_KINDS).not.toContain("GRAPH");
    expect(JSON.stringify(researchFixtures)).not.toMatch(/FUNCTION_PLOT|"GRAPH"/);
    expect(copyFixture("cambridge-kinetics-concept-graph-practical").expected.attention.representations[0]?.kind).toBe("PLOT");
  });

  it.each(["FUNCTION_PLOT", "DATA_PLOT", "ECONOMICS_GRAPH", "CHEMISTRY_GRAPH"])("rejects top-level representation kind %s even when candidate and projection agree", kind => {
    const fixture = copyFixture();
    Object.assign(fixture.input.candidates![0]!, { representationKind: kind });
    Object.assign(fixture.expected.attention.representations[0]!, { kind });
    expect(learnerProjectionFixtureErrors(fixture)).toContain("candidate algorithm-code has unsupported representation kind");
    expect(learnerProjectionFixtureErrors(fixture)).toContain("representation algorithm-code has unsupported kind");
  });

  it("rejects the superseded WorkBlock GRAPH even when candidate and projection agree", () => {
    const fixture = copyFixture();
    Object.assign(fixture.input.candidates![1]!, { workKind: "GRAPH" });
    Object.assign(fixture.expected.workSurface!.blocks[0]!, { kind: "GRAPH" });
    expect(learnerProjectionFixtureErrors(fixture)).toContain("candidate dry-run-table has unsupported work kind");
    expect(learnerProjectionFixtureErrors(fixture)).toContain("work block dry-run-table has unsupported kind");
  });

  it.each(["FOLLOW_LIVE", "INSPECTING_HISTORY"])("rejects superseded personal navigation input %s", mode => {
    const fixture = copyFixture();
    Object.assign(fixture.input, { navigation: { mode, coreId: "algorithm-trace" } });
    expect(learnerProjectionFixtureErrors(fixture)).toContain("renderer/legacy field leaked into contract at input.navigation");
  });

  it("rejects return-to-live output", () => {
    const fixture = copyFixture();
    Object.assign(fixture.expected, { liveReturn: "AVAILABLE" });
    expect(learnerProjectionFixtureErrors(fixture)).toContain("renderer/legacy field leaked into contract at projection.liveReturn");
  });

  it("consumes accepted teacher refocus after a tangent without inventing knowledge or personal navigation", () => {
    const tangent = copyFixture("mit-free-tangent-and-return");
    const before = structuredClone(tangent.input.state);
    const returned = structuredClone(tangent);
    returned.input.previousProjection = tangent.expected;
    returned.input.recentChanges = [{ ref: { kind: "CORE", id: "equilibrium" }, kind: "REFOCUSED" }];
    returned.expected.projector = "REFRAME_ATTENTION";
    expect(learnerProjectionFixtureErrors(tangent)).toEqual([]);
    expect(learnerProjectionFixtureErrors(returned)).toEqual([]);
    expect(returned.input.state).toEqual(before);
    expect(returned.expected.attention).toEqual(tangent.expected.attention);
    expect(returned.expected.transition.knowledge).toBe("PRESERVE");
    expect(Object.keys(returned.input.state.knowledge.cores)).toEqual(["thermodynamics", "equilibrium"]);
  });

  it("allows accepted revision to preserve knowledge while following attention outside the useful view", () => {
    const visible = copyFixture("cambridge-ionisation-representation-switch");
    const outsideView = structuredClone(visible);
    outsideView.expected.projector = "FOLLOW_ATTENTION";
    expect(visible.input.recentChanges[0]?.kind).toBe("REVISED");
    expect(visible.expected.projector).toBe("PRESERVE_VIEW");
    expect(learnerProjectionFixtureErrors(visible)).toEqual([]);
    expect(learnerProjectionFixtureErrors(outsideView)).toEqual([]);
    expect(outsideView.expected.transition.knowledge).toBe("PRESERVE");
    expect(outsideView.input.state).toEqual(visible.input.state);
  });

  it("does not require camera movement just because accepted knowledge advances", () => {
    const fixture = copyFixture("cambridge-kinetics-concept-graph-practical");
    fixture.expected.projector = "PRESERVE_VIEW";
    expect(fixture.expected.transition.knowledge).toBe("ADVANCE");
    expect(learnerProjectionFixtureErrors(fixture)).toEqual([]);
  });

  it("can reframe an accepted Core shift while deriving the earlier Core as Parked", () => {
    const fixture = copyFixture("mit-free-tangent-and-return");
    fixture.input.state.knowledge.currentCoreId = "thermodynamics";
    fixture.input.recentChanges = [{ kind: "REFOCUSED", ref: { kind: "CORE", id: "thermodynamics" } }];
    fixture.expected.attention = { anchor: { kind: "CORE", id: "thermodynamics" }, emphasis: [], context: [], support: [], representations: [] };
    fixture.expected.parkedCoreIds = ["equilibrium"];
    fixture.expected.projector = "REFRAME_ATTENTION";
    expect(learnerProjectionFixtureErrors(fixture)).toEqual([]);
    expect(fixture.input.state.knowledge.cores.equilibrium).toBeDefined();
  });

  it("expresses comparison and synthesis reframing without geometry", () => {
    for (const fixture of fixtures.filter(item => item.expected.transition.framing !== "FOCUS")) {
      expect(fixture.expected.projector).toBe("REFRAME_ATTENTION");
      expect(typeof fixture.expected.projector).toBe("string");
    }
    const widened = copyFixture("rsc-group2-review-widen");
    expect(widened.expected.attention.emphasis).toHaveLength(3);
    expect(widened.expected.attention.context).toContainEqual({ kind: "OBJECT", coreId: "periodicity", id: "ionisation-trend" });
    expect(widened.expected.transition.knowledge).toBe("PRESERVE");
  });

  it.each([
    ["knowledge", "REVISE", "unsupported knowledge transition"],
    ["framing", "LECTURE", "unsupported attention framing"],
  ])("rejects superseded or unreviewed transition %s=%s", (field, value, error) => {
    const fixture = copyFixture();
    Object.assign(fixture.expected.transition, { [field]: value });
    expect(learnerProjectionFixtureErrors(fixture)).toContain(error);
  });

  it("rejects camera geometry as projector intent", () => {
    const fixture = copyFixture();
    Object.assign(fixture.expected, { projector: { x: 10, y: 20, zoom: 0.5 } });
    expect(learnerProjectionFixtureErrors(fixture)).toContain("unsupported shared projector intent");
  });

  it("keeps the Skill producer seam optional and uses the same structured candidates", () => {
    const fixture = copyFixture();
    expect(fixture.input.candidates!.map(candidate => candidate.candidateType)).toEqual(["REPRESENTATION", "WORK"]);
    for (const candidate of fixture.input.candidates!) {
      expect(candidate.producer).toEqual({ skillId: "fixture-structured-surface" });
      delete candidate.producer;
    }
    expect(learnerProjectionFixtureErrors(fixture)).toEqual([]);
  });

  it.each(["REPRESENTATION", "WORK"] as const)("does not let Skill metadata authorize an unknown semantic reference in %s", candidateType => {
    const fixture = copyFixture();
    const candidate = fixture.input.candidates!.find(item => item.candidateType === candidateType)!;
    const unknown = { kind: "OBJECT" as const, coreId: "algorithm-trace", id: "skill-invented-claim" };
    if (candidate.candidateType === "REPRESENTATION") candidate.target = unknown;
    else candidate.semanticRefs = [unknown];
    expect(learnerProjectionFixtureErrors(fixture)).toContain(
      `candidate ${candidate.id} references unknown semantic unit OBJECT:algorithm-trace:skill-invented-claim`,
    );
  });

  it.each(["missing", "uncommitted"] as const)("rejects %s evidence identity on a Skill-produced candidate", evidence => {
    const fixture = copyFixture();
    fixture.input.candidates![0]!.evidenceCheckpointIds = evidence === "missing" ? [] : ["not-committed"];
    expect(learnerProjectionFixtureErrors(fixture)).toContain(evidence === "missing"
      ? "candidate algorithm-code lacks committed-evidence identity"
      : "candidate algorithm-code references uncommitted evidence not-committed");
  });

  it("rejects candidates without a committed evidence set", () => {
    const fixture = copyFixture();
    delete fixture.input.committedEvidenceCheckpointIds;
    expect(learnerProjectionFixtureErrors(fixture)).toContain("transient candidates supplied without committed evidence identities");
  });

  it("keeps candidate identity unique across Skills and candidate types", () => {
    const fixture = copyFixture();
    fixture.input.candidates![1]!.id = fixture.input.candidates![0]!.id;
    fixture.input.candidates![1]!.producer = { skillId: "another-skill" };
    expect(learnerProjectionFixtureErrors(fixture)).toContain("duplicate projection candidate id");
  });

  it("allows a grounded Skill candidate to be ignored and Work Surface to be discarded without changing Core or Cue", () => {
    const fixture = copyFixture();
    const before = structuredClone(fixture.input.state);
    fixture.expected.attention.representations = [];
    delete fixture.expected.workSurface;
    expect(learnerProjectionFixtureErrors(fixture)).toEqual([]);
    expect(fixture.input.candidates).toHaveLength(2);
    expect(fixture.input.state).toEqual(before);
  });

  it("rejects durable Work Surface lifecycle", () => {
    const fixture = copyFixture();
    Object.assign(fixture.expected.workSurface!, { lifecycle: "DURABLE" });
    expect(learnerProjectionFixtureErrors(fixture)).toContain("Work Surface must remain ephemeral");
  });

  it("rejects projected blocks that disagree with their grounded candidates", () => {
    const fixture = copyFixture();
    fixture.expected.attention.representations[0]!.kind = "TEXT";
    fixture.expected.workSurface!.blocks[0]!.status = "SETTLED";
    const errors = learnerProjectionFixtureErrors(fixture);
    expect(errors).toContain("representation algorithm-code does not match its candidate");
    expect(errors).toContain("work block dry-run-table does not match its candidate");
  });

  it.each(["DIRECT", "STRUCTURED_DERIVED", "GENERATIVE"])("rejects a producer risk class %s as a candidate type", candidateType => {
    const fixture = copyFixture();
    Object.assign(fixture.input.candidates![0]!, { candidateType });
    expect(learnerProjectionFixtureErrors(fixture)).toContain("unsupported candidate type");
  });

  it.each([
    { skillId: "" },
    { skillId: "skill", authority: "ACCEPTED" },
    { skillId: "skill", riskClass: "GENERATIVE" },
  ])("rejects invalid or authority-bearing Skill metadata: %j", producer => {
    const fixture = copyFixture();
    Object.assign(fixture.input.candidates![0]!, { producer });
    expect(learnerProjectionFixtureErrors(fixture)).toContain("candidate algorithm-code has invalid Skill producer metadata");
  });

  it.each(["claim", "causalRelationship", "interpretation", "correction"])("rejects a Skill's new %s payload at the projection boundary", field => {
    const fixture = copyFixture();
    Object.assign(fixture.input.candidates![0]!, { [field]: "New lesson truth needs semantic acceptance." });
    expect(learnerProjectionFixtureErrors(fixture)).toContain(`candidate algorithm-code has unsupported field ${field}`);
  });

  it.each(["html", "svg", "x", "y", "coordinates", "teachingStyle", "learnerEmotion"])("rejects %s in Skill candidates and projected output", field => {
    const fixture = copyFixture();
    Object.assign(fixture.input.candidates![0]!, { [field]: "forbidden" });
    Object.assign(fixture.expected, { [field]: "forbidden" });
    const errors = learnerProjectionFixtureErrors(fixture);
    expect(errors).toContain(`renderer/legacy field leaked into contract at candidate:algorithm-code.${field}`);
    expect(errors).toContain(`renderer/legacy field leaked into contract at projection.${field}`);
  });

  it("continues to reject unknown recent changes and projected semantic identities", () => {
    const fixture = copyFixture();
    const ref = { kind: "CORE" as const, id: "unaccepted" };
    fixture.input.recentChanges = [{ kind: "REFOCUSED", ref }];
    fixture.expected.attention.anchor = ref;
    const errors = learnerProjectionFixtureErrors(fixture);
    expect(errors).toContain("unknown recent change CORE:unaccepted");
    expect(errors).toContain("unknown projected reference CORE:unaccepted");
  });

  it("allows co-primary representations only for deliberate comparison", () => {
    const fixture = copyFixture("english-original-rewrite-comparison");
    expect(learnerProjectionFixtureErrors(fixture)).toEqual([]);
    fixture.expected.transition.framing = "FOCUS";
    expect(learnerProjectionFixtureErrors(fixture)).toContain("more than one dominant representation outside COMPARE");
  });
});
