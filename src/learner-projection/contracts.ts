import type { CoreTeachingState, SemanticReference } from "../lesson-stream/core/contracts.ts";
import type { PresentationMode } from "../session/presentation-mode.ts";

/**
 * M4A is a learner-facing projection of accepted lesson truth.
 * Nothing in this module is semantic authority. Geometry, renderer state and
 * durable Active/Retained/focus-style slots are intentionally absent.
 */

export type RepresentationKind =
  | "TEXT"
  | "MATH"
  | "CHEMICAL_EQUATION"
  | "MOLECULE_2D"
  | "PLOT"
  | "TABLE"
  | "DIAGRAM"
  | "APPARATUS"
  | "CODE"
  | "SOURCE_TEXT"
  | "IMAGE"
  | "MAP"
  | "TIMELINE";

export type RepresentationIntent = {
  id: string;
  kind: RepresentationKind;
  role: "dominant" | "companion";
  /** Optional semantic anchor. Rendered HTML/SVG/coordinates never belong here. */
  target?: SemanticReference;
};

export type WorkBlockKind =
  | "TEXT"
  | "EQUATION"
  | "TABLE"
  | "PLOT"
  | "OBSERVATION"
  | "MOLECULE"
  | "DIAGRAM"
  | "APPARATUS"
  | "CODE"
  | "SOURCE_TEXT"
  | "IMAGE"
  | "MAP"
  | "TIMELINE";

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
 * Grounded, non-authoritative surface candidates supplied by the host/runtime.
 * M4A does not define their producer. A later producer may be deterministic,
 * teacher-controlled or model-assisted, but every transient candidate must be
 * tied to committed evidence and can be ignored by the learner projection.
 */
export type ProjectionCandidate =
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
    };

export type ProjectionTransition = {
  /** Whether learner-visible knowledge advances or the established context is held. */
  knowledge: "PRESERVE" | "ADVANCE";
  /** FOCUS is ordinary teaching; COMPARE and WIDEN are deliberate wider frames. */
  framing: "FOCUS" | "COMPARE" | "WIDEN";
  /** PAIR keeps one dominant representation and adds a justified companion. */
  representation: "KEEP" | "SWITCH" | "PAIR";
};

export type LearnerNavigationState =
  | { mode: "FOLLOW_LIVE" }
  | { mode: "INSPECTING_HISTORY"; coreId: string };

export type NavigationIntent = {
  camera: "FOLLOW_ATTENTION" | "PRESERVE_VIEW";
  liveReturn: "HIDDEN" | "AVAILABLE" | "EMPHASIZED";
};

export type RecentSemanticChange = {
  ref: SemanticReference;
  kind: "ADDED" | "REVISED" | "REFOCUSED" | "INVALIDATED" | "SUPERSEDED";
};

export type LearnerProjectionInput = {
  state: CoreTeachingState;
  recentChanges: RecentSemanticChange[];
  /** Exact committed evidence identities available to this projection turn. */
  committedEvidenceCheckpointIds?: string[];
  /** Optional transient candidates are inputs, never accepted lesson state. */
  candidates?: ProjectionCandidate[];
  presentationMode: PresentationMode;
  navigation: LearnerNavigationState;
  viewport: { width: number; height: number };
  previousProjection?: LearnerProjection;
};

export type LearnerProjection = {
  attention: {
    anchor?: SemanticReference;
    emphasis: SemanticReference[];
    context: SemanticReference[];
    /** Support is semantic history; omission from attention never deletes it. */
    support: SemanticReference[];
    representations: RepresentationIntent[];
    cue?: { cueId: string; role: "dominant" | "companion" };
  };
  workSurface?: EphemeralWorkSurface;
  transition: ProjectionTransition;
  navigation: NavigationIntent;
  /** Derived role only: every established Core except currentCoreId. */
  parkedCoreIds: string[];
};

export type ForbiddenProjectionBehavior =
  | "WRITE_VISUAL_STATE_TO_SEMANTICS"
  | "CREATE_DUPLICATE_CORE"
  | "TREAT_PARKED_AS_DURABLE_STATUS"
  | "DELETE_SUPPORT_ON_VISUAL_EVICTION"
  | "RELAYOUT_ESTABLISHED_KNOWLEDGE"
  | "YANK_FROM_HISTORY_INSPECTION"
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
  if (dominantRepresentations.length > 1) errors.push("more than one dominant representation");
  for (const representation of expected.attention.representations) {
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

  if (fixture.input.navigation.mode === "INSPECTING_HISTORY") {
    if (!state.knowledge.cores[fixture.input.navigation.coreId]) errors.push("inspection Core does not exist");
    if (fixture.input.navigation.coreId === state.knowledge.currentCoreId) errors.push("inspection target is current Core");
    if (expected.navigation.camera !== "PRESERVE_VIEW") errors.push("history inspection may not be yanked back to live attention");
  }

  for (const path of illegalProjectionKeys(expected)) errors.push(`renderer/legacy field leaked into contract at ${path}`);
  if (new Set(fixture.mustNot).size !== fixture.mustNot.length) errors.push("duplicate mustNot behavior");

  return errors;
}
