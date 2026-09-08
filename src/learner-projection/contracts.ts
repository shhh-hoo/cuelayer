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
  | "FUNCTION_PLOT"
  | "TABLE"
  | "DIAGRAM"
  | "APPARATUS";

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
  | "GRAPH"
  | "OBSERVATION"
  | "MOLECULE"
  | "DIAGRAM"
  | "APPARATUS";

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
  | "SHOW_ALL_AVAILABLE_REPRESENTATIONS"
  | "INFER_LEARNER_EMOTION";

export type LearnerProjectionFixture = {
  id: string;
  source: {
    family: "CAMBRIDGE" | "RSC" | "MIT_OCW";
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

function illegalProjectionKeys(value: unknown, path = "projection"): string[] {
  if (!value || typeof value !== "object") return [];
  const forbidden = new Set(["active", "retained", "focusId", "x", "y", "opacity", "html", "svg", "teachingStyle"]);
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

  for (const change of fixture.input.recentChanges) {
    if (!semanticReferenceExists(state, change.ref)) errors.push(`unknown recent change ${refKey(change.ref)}`);
  }
  for (const ref of projectionRefs(expected)) {
    if (!semanticReferenceExists(state, ref)) errors.push(`unknown projected reference ${refKey(ref)}`);
  }

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
