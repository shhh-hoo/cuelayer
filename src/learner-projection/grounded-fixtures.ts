import type { LearnerProjectionFixture, ProjectionCandidate } from "./contracts.ts";
import { M4A_LEARNER_PROJECTION_FIXTURES as CHEMISTRY_FIXTURES } from "./fixtures.ts";
import { M4A_CROSS_DISCIPLINE_FIXTURES } from "./cross-discipline-fixtures.ts";

export const M4A_RESEARCH_LEARNER_PROJECTION_FIXTURES: LearnerProjectionFixture[] = [
  ...CHEMISTRY_FIXTURES,
  ...M4A_CROSS_DISCIPLINE_FIXTURES,
];

/**
 * The research scenarios state what should be visible. This harness supplies
 * synthetic committed-evidence identities for every representation and Work
 * Surface block so the M4A consumer contract never invents a surface from Core
 * text alone. Production candidate generation is intentionally out of scope.
 */
function groundedCandidates(fixture: LearnerProjectionFixture): ProjectionCandidate[] {
  const representations: ProjectionCandidate[] = fixture.expected.attention.representations.map(item => ({
    candidateType: "REPRESENTATION",
    id: item.id,
    representationKind: item.kind,
    ...(item.target ? { target: item.target } : {}),
    evidenceCheckpointIds: [`fixture:${fixture.id}:${item.id}`],
  }));
  const work: ProjectionCandidate[] = (fixture.expected.workSurface?.blocks ?? []).map(block => ({
    candidateType: "WORK",
    id: block.id,
    workKind: block.kind,
    status: block.status,
    semanticRefs: block.semanticRefs,
    evidenceCheckpointIds: [`fixture:${fixture.id}:${block.id}`],
  }));
  return [...representations, ...work];
}

export const M4A_GROUNDED_LEARNER_PROJECTION_FIXTURES: LearnerProjectionFixture[] = M4A_RESEARCH_LEARNER_PROJECTION_FIXTURES.map(fixture => {
  const candidates = groundedCandidates(fixture);
  const committedEvidenceCheckpointIds = [...new Set(candidates.flatMap(candidate => candidate.evidenceCheckpointIds))];
  return {
    ...fixture,
    input: {
      ...fixture.input,
      ...(candidates.length ? { candidates, committedEvidenceCheckpointIds } : {}),
    },
    mustNot: candidates.length && !fixture.mustNot.includes("INVENT_UNGROUNDED_SURFACE")
      ? [...fixture.mustNot, "INVENT_UNGROUNDED_SURFACE"]
      : fixture.mustNot,
  };
});
