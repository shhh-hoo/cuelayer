import type { CoreTeachingState, SemanticReference } from "../lesson-stream/core/contracts.ts";
import type { PresentationMode } from "../session/presentation-mode.ts";

/**
 * M4A is a learner-facing projection of accepted lesson truth.
 * Nothing in this module is semantic authority. Geometry, renderer state and
 * durable Active/Retained/focus-style slots are intentionally absent.
 */

export const REPRESENTATION_KINDS = [
  "TEXT", "MATH", "CHEMICAL_EQUATION", "MOLECULE_2D", "PLOT", "TABLE", "DIAGRAM", "APPARATUS", "CODE", "SOURCE_TEXT", "IMAGE", "MAP", "TIMELINE",
] as const;
export type RepresentationKind = typeof REPRESENTATION_KINDS[number];

export type RepresentationIntent = {
  id: string;
  kind: RepresentationKind;
  /** COMPARE may give multiple representations co-primary (dominant) attention. */
  role: "dominant" | "companion";
  /** Optional semantic anchor. Rendered HTML/SVG/coordinates never belong here. */
  target?: SemanticReference;
};

export const WORK_BLOCK_KINDS = [
  "TEXT", "EQUATION", "TABLE", "PLOT", "OBSERVATION", "MOLECULE", "DIAGRAM", "APPARATUS", "CODE", "SOURCE_TEXT", "IMAGE", "MAP", "TIMELINE",
] as const;
export type WorkBlockKind = typeof WORK_BLOCK_KINDS[number];

export type WorkBlock = {
  id: string;
  kind: WorkBlockKind;
  status: "UNRESOLVED" | "IN_PROGRESS" | "SETTLED";
  semanticRefs: SemanticReference[];
};

export type EphemeralWorkSurface = {
  lifecycle: "EPHEMERAL";
  blocks: WorkBlock[];
};

/**
 * Grounded, non-authoritative, discardable candidates from the host or a domain Skill.
 * A Skill may use any internal mechanism, including a model; automatic output
 * must converge to this typed, grounded, validated structured boundary.
 * Producer metadata grants no authority. New truth-bearing claims, relations,
 * interpretations or corrections must return through semantic interpretation,
 * grounding and verification before they can become accepted lesson knowledge.
 * Selection never promotes a candidate to Core or Cue.
 */
export type ProjectionCandidate = {
  /** Optional extension seam; no Skill runtime or producer taxonomy in M4A. */
  producer?: { skillId: string };
} & (
  | {
      candidateType: "REPRESENTATION";
      id: string;
      representationKind: RepresentationKind;
      target?: SemanticReference;
      evidenceCheckpointIds: string[];
    }
  | {
      candidateType: "WORK";
      id: string;
      workKind: WorkBlockKind;
      status: WorkBlock["status"];
      semanticRefs: SemanticReference[];
      evidenceCheckpointIds: string[];
    }
);

export type ProjectionTransition = {
  /** Whether learner-visible knowledge advances or the established context is held. */
  knowledge: "PRESERVE" | "ADVANCE";
  /** FOCUS: one neighborhood; COMPARE: co-primary targets; WIDEN: broader established structure. */
  framing: "FOCUS" | "COMPARE" | "WIDEN";
  /** PAIR adds a justified companion, or a co-primary representation in COMPARE. */
  representation: "KEEP" | "SWITCH" | "PAIR";
};

/**
 * The shared classroom projector follows accepted teaching attention, never raw
 * speech. This expresses intent only; visibility thresholds, layout, geometry
 * and camera execution belong to M4B.
 */
export type SharedProjectorIntent =
  /** Teaching attention remains comfortably visible, including during a tangent. */
  | "PRESERVE_VIEW"
  /** Accepted attention leaves the useful view; follow without a new composition. */
  | "FOLLOW_ATTENTION"
  /** A comparison, widening, Core shift or teacher refocus needs a new composition. */
  | "REFRAME_ATTENTION";

export type RecentSemanticChange = {
  ref: SemanticReference;
  kind: "ADDED" | "REVISED" | "REFOCUSED" | "INVALIDATED" | "SUPERSEDED";
};

export type LearnerProjectionInput = {
  state: CoreTeachingState;
  /** Already accepted semantic/attention changes; raw speech is never an attention input. */
  recentChanges: RecentSemanticChange[];
  /** Exact committed evidence identities available to this projection turn. */
  committedEvidenceCheckpointIds?: string[];
  /** Optional transient candidates are inputs, never accepted lesson state. */
  candidates?: ProjectionCandidate[];
  presentationMode: PresentationMode;
  viewport: { width: number; height: number };
  previousProjection?: LearnerProjection;
};

export type LearnerProjection = {
  attention: {
    anchor?: SemanticReference;
    /** Co-primary semantic targets in COMPARE; none is demoted to context. */
    emphasis: SemanticReference[];
    context: SemanticReference[];
    /** Support is semantic history; omission from attention never deletes it. */
    support: SemanticReference[];
    representations: RepresentationIntent[];
    cue?: { cueId: string; role: "dominant" | "companion" };
  };
  workSurface?: EphemeralWorkSurface;
  transition: ProjectionTransition;
  projector: SharedProjectorIntent;
  /** Derived role only: every established Core except currentCoreId. */
  parkedCoreIds: string[];
};

export type ForbiddenProjectionBehavior =
  | "WRITE_VISUAL_STATE_TO_SEMANTICS"
  | "CREATE_DUPLICATE_CORE"
  | "TREAT_PARKED_AS_DURABLE_STATUS"
  | "DELETE_SUPPORT_ON_VISUAL_EVICTION"
  | "RELAYOUT_ESTABLISHED_KNOWLEDGE"
  | "LEAK_ANSWER_DURING_PRODUCTIVE_STRUGGLE"
  | "PERSIST_WORK_AS_KNOWLEDGE"
  | "INVENT_UNGROUNDED_SURFACE"
  | "SHOW_ALL_AVAILABLE_REPRESENTATIONS"
  | "INFER_LEARNER_EMOTION"
  | "COLLAPSE_COMPETING_INTERPRETATIONS"
  | "REPLACE_PRIMARY_SOURCE_WITH_SUMMARY";

export type ProjectionSubject =
  | "CHEMISTRY"
  | "MATHEMATICS"
  | "PHYSICS"
  | "BIOLOGY"
  | "COMPUTER_SCIENCE"
  | "ECONOMICS"
  | "HISTORY"
  | "ENGLISH_LANGUAGE"
  | "GEOGRAPHY";

export type LearnerProjectionFixture = {
  id: string;
  source: {
    family: "CAMBRIDGE" | "RSC" | "MIT_OCW";
    subject?: ProjectionSubject;
    title: string;
    url: string;
  };
  sequenceSummary: string;
  input: LearnerProjectionInput;
  expected: LearnerProjection;
  mustNot: ForbiddenProjectionBehavior[];
};

const refKey = (ref: SemanticReference) =>
  ref.kind === "CORE" || ref.kind === "CUE"
    ? `${ref.kind}:${ref.id}`
    : `${ref.kind}:${ref.coreId}:${ref.id}`;

export function semanticReferenceExists(state: CoreTeachingState, ref: SemanticReference) {
  if (ref.kind === "CUE") return state.cue.active?.id === ref.id;
  if (ref.kind === "CORE") return Boolean(state.knowledge.cores[ref.id]);
  const core = state.knowledge.cores[ref.coreId];
  if (!core) return false;
  if (ref.kind === "OBJECT") return Boolean(core.objects[ref.id]);
  if (ref.kind === "RELATION") return Boolean(core.relations[ref.id]);
  return Boolean(core.supports[ref.id]);
}

function projectionRefs(projection: LearnerProjection) {
  const refs: SemanticReference[] = [];
  if (projection.attention.anchor) refs.push(projection.attention.anchor);
  refs.push(...projection.attention.emphasis, ...projection.attention.context, ...projection.attention.support);
  for (const representation of projection.attention.representations) {
    if (representation.target) refs.push(representation.target);
  }
  for (const block of projection.workSurface?.blocks ?? []) refs.push(...block.semanticRefs);
  return refs;
}

function candidateRefs(candidate: ProjectionCandidate) {
  if (candidate.candidateType === "REPRESENTATION") return candidate.target ? [candidate.target] : [];
  return candidate.semanticRefs;
}

function sameRef(a: SemanticReference | undefined, b: SemanticReference | undefined) {
  if (!a || !b) return a === b;
  return refKey(a) === refKey(b);
}

function illegalProjectionKeys(value: unknown, path = "projection"): string[] {
  if (!value || typeof value !== "object") return [];
  const forbidden = new Set([
    "active", "retained", "focusId", "x", "y", "opacity", "html", "svg", "teachingStyle", "emotion", "learnerEmotion",
    "navigation", "liveReturn", "zoom", "coordinates", "position", "reactFlowId",
  ]);
  const errors: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbidden.has(key)) errors.push(`${path}.${key}`);
    if (Array.isArray(child)) child.forEach((item, index) => errors.push(...illegalProjectionKeys(item, `${path}.${key}[${index}]`)));
    else errors.push(...illegalProjectionKeys(child, `${path}.${key}`));
  }
  return errors;
}

/** Fixture-level hard invariants. This validates the contract examples, not pedagogy quality. */
export function learnerProjectionFixtureErrors(fixture: LearnerProjectionFixture) {
  const errors: string[] = [];
  const { state } = fixture.input;
  const { expected } = fixture;
  const candidates = fixture.input.candidates ?? [];
  const committedEvidence = new Set(fixture.input.committedEvidenceCheckpointIds ?? []);

  for (const change of fixture.input.recentChanges) {
    if (!semanticReferenceExists(state, change.ref)) errors.push(`unknown recent change ${refKey(change.ref)}`);
  }
  for (const ref of projectionRefs(expected)) {
    if (!semanticReferenceExists(state, ref)) errors.push(`unknown projected reference ${refKey(ref)}`);
  }
  if (candidates.length && !committedEvidence.size) errors.push("transient candidates supplied without committed evidence identities");
  for (const candidate of candidates) {
    if (candidate.candidateType === "REPRESENTATION") {
      if (!REPRESENTATION_KINDS.includes(candidate.representationKind)) errors.push(`candidate ${candidate.id} has unsupported representation kind`);
    } else if (candidate.candidateType === "WORK") {
      if (!WORK_BLOCK_KINDS.includes(candidate.workKind)) errors.push(`candidate ${candidate.id} has unsupported work kind`);
    } else {
      errors.push("unsupported candidate type");
      continue;
    }
    const fields = candidate.candidateType === "REPRESENTATION"
      ? ["candidateType", "id", "representationKind", "target", "evidenceCheckpointIds", "producer"]
      : ["candidateType", "id", "workKind", "status", "semanticRefs", "evidenceCheckpointIds", "producer"];
    for (const key of Object.keys(candidate)) {
      if (!fields.includes(key)) errors.push(`candidate ${candidate.id} has unsupported field ${key}`);
    }
    if (candidate.producer && (
      typeof candidate.producer.skillId !== "string" || !candidate.producer.skillId.trim() ||
      Object.keys(candidate.producer).some(key => key !== "skillId")
    )) errors.push(`candidate ${candidate.id} has invalid Skill producer metadata`);
    for (const path of illegalProjectionKeys(candidate, `candidate:${candidate.id}`)) {
      errors.push(`renderer/legacy field leaked into contract at ${path}`);
    }
    if (!candidate.evidenceCheckpointIds.length) errors.push(`candidate ${candidate.id} lacks committed-evidence identity`);
    for (const checkpointId of candidate.evidenceCheckpointIds) {
      if (!committedEvidence.has(checkpointId)) errors.push(`candidate ${candidate.id} references uncommitted evidence ${checkpointId}`);
    }
    for (const ref of candidateRefs(candidate)) {
      if (!semanticReferenceExists(state, ref)) errors.push(`candidate ${candidate.id} references unknown semantic unit ${refKey(ref)}`);
    }
  }
  if (new Set(candidates.map(candidate => candidate.id)).size !== candidates.length) errors.push("duplicate projection candidate id");

  const attentionRoleRefs = [
    ...(expected.attention.anchor ? [expected.attention.anchor] : []),
    ...expected.attention.emphasis,
    ...expected.attention.context,
    ...expected.attention.support,
  ];
  const keys = attentionRoleRefs.map(refKey);
  if (new Set(keys).size !== keys.length) errors.push("semantic reference occupies multiple attention roles");
  if (expected.attention.support.some(ref => ref.kind !== "SUPPORT")) errors.push("attention.support contains non-Support reference");

  const dominantRepresentations = expected.attention.representations.filter(item => item.role === "dominant");
  if (expected.transition.framing !== "COMPARE" && dominantRepresentations.length > 1) {
    errors.push("more than one dominant representation outside COMPARE");
  }
  for (const representation of expected.attention.representations) {
    if (!REPRESENTATION_KINDS.includes(representation.kind)) errors.push(`representation ${representation.id} has unsupported kind`);
    const candidate = candidates.find(item => item.id === representation.id && item.candidateType === "REPRESENTATION");
    if (!candidate || candidate.candidateType !== "REPRESENTATION") {
      errors.push(`representation ${representation.id} has no grounded transient candidate`);
      continue;
    }
    if (candidate.representationKind !== representation.kind || !sameRef(candidate.target, representation.target)) {
      errors.push(`representation ${representation.id} does not match its candidate`);
    }
  }

  for (const block of expected.workSurface?.blocks ?? []) {
    if (!WORK_BLOCK_KINDS.includes(block.kind)) errors.push(`work block ${block.id} has unsupported kind`);
    const candidate = candidates.find(item => item.id === block.id && item.candidateType === "WORK");
    if (!candidate || candidate.candidateType !== "WORK") {
      errors.push(`work block ${block.id} has no grounded transient candidate`);
      continue;
    }
    const sameRefs = JSON.stringify(candidate.semanticRefs.map(refKey)) === JSON.stringify(block.semanticRefs.map(refKey));
    if (candidate.workKind !== block.kind || candidate.status !== block.status || !sameRefs) errors.push(`work block ${block.id} does not match its candidate`);
  }

  if (expected.attention.cue && state.cue.active?.id !== expected.attention.cue.cueId) errors.push("projected Cue is not current Cue");

  const derivedParked = Object.keys(state.knowledge.cores)
    .filter(coreId => coreId !== state.knowledge.currentCoreId)
    .sort();
  if (JSON.stringify([...expected.parkedCoreIds].sort()) !== JSON.stringify(derivedParked)) errors.push("parked Core projection is not derived from currentCoreId");

  if (!["PRESERVE", "ADVANCE"].includes(expected.transition.knowledge)) errors.push("unsupported knowledge transition");
  if (!["FOCUS", "COMPARE", "WIDEN"].includes(expected.transition.framing)) errors.push("unsupported attention framing");
  if (!["PRESERVE_VIEW", "FOLLOW_ATTENTION", "REFRAME_ATTENTION"].includes(expected.projector)) errors.push("unsupported shared projector intent");
  if (expected.workSurface && expected.workSurface.lifecycle !== "EPHEMERAL") errors.push("Work Surface must remain ephemeral");
  // Inspect projection context, not accepted state (which legitimately contains cue.active).
  const { state: _state, ...context } = fixture.input;
  for (const path of illegalProjectionKeys(context, "input")) errors.push(`renderer/legacy field leaked into contract at ${path}`);
  for (const path of illegalProjectionKeys(expected)) errors.push(`renderer/legacy field leaked into contract at ${path}`);
  if (new Set(fixture.mustNot).size !== fixture.mustNot.length) errors.push("duplicate mustNot behavior");

  return errors;
}
