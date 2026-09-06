import type { TeachingInterpretationRequest } from "../../src/lesson-stream/contracts.ts";
import type { AlphaSemanticProfile } from "../../src/lesson-stream/semantic-profile.ts";
import type { ProviderProposal } from "./provider-contract.ts";

export const OUTPUT_PROTOCOL_VERSION = "teaching-output-refs-v1";
export const usesCompactOutput = (profile: AlphaSemanticProfile) => profile.id === "alpha-continuous-bounded-v9";
type Namespace = "e" | "b" | "c" | "s";
type CompactProposal = Pick<ProviderProposal, "steps" | "warnings">;

/** Only structural reference fields are transformed. Speech, content and warnings stay byte-for-byte intact. */
function mapReferences(value: unknown, reference: (kind: Namespace, id: string) => string, path: string[] = []): unknown {
  if (Array.isArray(value)) return value.map((item, index) => mapReferences(item, reference, [...path, String(index)]));
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(object).map(([key, item]) => {
    let kind: Namespace | undefined;
    if (key === "checkpointId" || ["consumesCheckpointIds", "sourceCheckpointIds", "sourceSegmentIds"].includes(key)) kind = "e";
    if (key === "targetBoardItemId" || key === "invalidatesBoardItemIds") kind = "b";
    if (key === "targetCueId") kind = "c";
    if (path.at(-1) === "contributionIds" && (key === "board" || key === "cue")) kind = key === "board" ? "b" : "c";
    if (key === "id") {
      if (object.kind === "BOARD_ITEM") kind = "b";
      else if (object.kind === "ACTIVE_CUE") kind = "c";
      else if (path.join(".") === "currentState.board.active" || /^currentState\.board\.retained\.\d+$/.test(path.join("."))) kind = "b";
      else if (path.join(".") === "currentState.cue.active") kind = "c";
      else if (/^currentState\.board\.support\.\d+$/.test(path.join("."))) kind = "s";
    }
    if (kind && typeof item === "string") return [key, reference(kind, item)];
    if (kind && Array.isArray(item)) return [key, item.map(id => reference(kind, id as string))];
    return [key, mapReferences(item, reference, [...path, key])];
  }));
}

/** Bind before awaiting the provider: transport identity/revisions never come from a later live state. */
export function createOutputReferenceCodec(request: TeachingInterpretationRequest) {
  const identity = { requestId: request.requestId, baseBoardRevision: request.currentState.board.revision, baseCueRevision: request.currentState.cue.revision };
  const byId = { e: new Map<string, string>(), b: new Map<string, string>(), c: new Map<string, string>(), s: new Map<string, string>() };
  const byHandle = { e: new Map<string, string>(), b: new Map<string, string>(), c: new Map<string, string>(), s: new Map<string, string>() };
  const input = mapReferences(request, (kind, id) => {
    const existing = byId[kind].get(id);
    if (existing) return existing;
    const handle = `${kind}${byId[kind].size}`;
    byId[kind].set(id, handle); byHandle[kind].set(handle, id);
    return handle;
  }) as TeachingInterpretationRequest;
  // These reserve the existing reducer's per-step identities, without asserting an item exists.
  // The unchanged validator still checks creation order, current targets and optional linkage.
  for (let index = 0; index < 20; index += 1) {
    for (const [kind, prefix] of [["b", "board"], ["c", "cue"]] as const) {
      const id = `${prefix}-${identity.requestId}-accepted-${index}`;
      byHandle[kind].set(`n${kind}${index}`, id); byId[kind].set(id, `n${kind}${index}`);
    }
  }
  const translate = (direction: "encode" | "decode", value: unknown) => mapReferences(value, (kind, id) => {
    const translated = (direction === "encode" ? byId : byHandle)[kind].get(id);
    if (translated === undefined) throw new Error(`teaching-output-reference-unknown:${kind}:${id}`);
    return translated;
  });
  return {
    input,
    audit: { version: OUTPUT_PROTOCOL_VERSION, ...identity, handles: Object.fromEntries(Object.entries(byHandle).map(([kind, entries]) => [kind, Object.fromEntries(entries)])) },
    encode(proposal: ProviderProposal): CompactProposal {
      return translate("encode", { steps: proposal.steps, warnings: proposal.warnings }) as CompactProposal;
    },
    expand(proposal: CompactProposal): ProviderProposal {
      return { ...identity, ...translate("decode", proposal) as CompactProposal };
    },
  };
}

/** Wire instructions only; teaching decisions and the semantic policy remain unchanged. */
export function compactOutputPolicy(policy: string) {
  return policy
    .replace("6. Copy requestId exactly and copy current Board/Cue revisions.", "6. Return only steps and warnings. Deterministic code binds requestId and Board/Cue base revisions from this request snapshot.")
    .replace("Copy each complete opaque ID from the input character-for-character; never type one from its pattern, shorten it, repeat a segment, or combine parts of two IDs.", "Copy each supplied request-local reference handle exactly; never invent a handle or combine parts of two handles.")
    .replace("Within one proposal, SET_ACTIVE in step N creates board-${requestId}-accepted-N, where N is the zero-based step index. A later step may target that exact ID.", "Within one proposal, SET_ACTIVE in step N creates Board handle nbN; Cue SET/REPLACE_CURRENT creates Cue handle ncN. N is the zero-based step index (0–19). A later step may reference an earlier created item. These handles reserve identities only; a KEEP step creates no item.")
    + `\nOutput protocol: ${OUTPUT_PROTOCOL_VERSION}. Evidence handles e0, e1, … identify immutable supplied checkpoints; b0, b1, … identify Board items; c0, c1, … identify Cues. They are request-local and have no ordering or semantic meaning. Support handles s0, s1, … are not Board item targets. Use the same handles in consumption, trigger evidence, contribution provenance, targets and invalidations. Code expands them before the existing validator; unknown/wrong-kind handles are rejected. Text, content, warnings and quotes are literal language, never reference handles. Do not output requestId or base revisions.`;
}
