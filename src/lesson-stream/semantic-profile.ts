import type { ContributionMode, TeachingCueKind } from "./contracts.ts";

export type AlphaSemanticProfile = {
  id: "alpha-core-p4-v6" | "alpha-augment-p4-v6";
  policyVersion: "bounded-agent-p4-semantics-v6";
  contextProjection: "P4";
  boardActiveModes: readonly ContributionMode[];
  boardSupportModes: readonly ContributionMode[];
  cueModes: Readonly<Record<TeachingCueKind, readonly ContributionMode[]>>;
  autonomousCorrection: false;
  autonomousInitiation: false;
};

const cueModes = {
  NOTE: ["RECONSTRUCT", "REPRESENT"],
  QUESTION: ["RECONSTRUCT", "REPRESENT"],
  TASK: ["RECONSTRUCT", "REPRESENT"],
  HINT: ["RECONSTRUCT", "REPRESENT"],
} as const;

export const ALPHA_CORE_P4: AlphaSemanticProfile = Object.freeze({
  id: "alpha-core-p4-v6",
  policyVersion: "bounded-agent-p4-semantics-v6",
  contextProjection: "P4",
  boardActiveModes: ["RECONSTRUCT", "REPRESENT"] as const,
  boardSupportModes: ["RECONSTRUCT", "REPRESENT"] as const,
  cueModes,
  autonomousCorrection: false,
  autonomousInitiation: false,
});

export const ALPHA_AUGMENT_CANDIDATE_P4: AlphaSemanticProfile = Object.freeze({
  ...ALPHA_CORE_P4,
  id: "alpha-augment-p4-v6",
  boardActiveModes: ["RECONSTRUCT", "REPRESENT", "AUGMENT"] as const,
  boardSupportModes: ["RECONSTRUCT", "REPRESENT", "AUGMENT"] as const,
});

/** The only profile used by the normal endpoint. Promotion is a reviewed code change. */
export const ACTIVE_ALPHA_SEMANTIC_PROFILE = ALPHA_CORE_P4;

export function contributionModeAllowed(
  profile: AlphaSemanticProfile,
  channel: "BOARD_ACTIVE" | "BOARD_SUPPORT" | TeachingCueKind,
  mode: ContributionMode,
) {
  if (channel === "BOARD_ACTIVE") return profile.boardActiveModes.includes(mode);
  if (channel === "BOARD_SUPPORT") return profile.boardSupportModes.includes(mode);
  return profile.cueModes[channel].includes(mode);
}
