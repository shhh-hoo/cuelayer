import type { DisplayIntent, GroundedTextReference, LearnerIntent, LiveDecisionEvidence, PlannerInput, RuntimeDecision } from "./contracts";
import { CUECAPTION_SYMBOLIC_REWRITES } from "./generated/cuecaption-policy.ts";

type UnknownRecord = Record<string, unknown>;
export type ValidationDegradation = "invalid-relation" | "invalid-transform" | "invalid-focus" | "invalid-text" | "invalid-decision" | "provider-fallback";
export type ValidationResult = { ok: true; decision: RuntimeDecision; degradation?: ValidationDegradation } | { ok: false; error: string };

const quietReasons = new Set(["filler", "transition", "repetition", "unfinished", "insufficient-evidence"]);
const warningCodes = new Set(["ASR_AMBIGUITY", "MISSING_STRUCTURE", "MISSING_REFERENCE", "MISSING_REACTION_FACT", "POSSIBLE_TEACHER_ERROR", "CONTEXT_CONFLICT"]);
const record = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const exactKeys = (value: UnknownRecord, keys: string[]) => Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => Object.hasOwn(value, key));
const optionalKeys = (value: UnknownRecord, required: string[], optional: string[]) => Object.keys(value).every((key) => [...required, ...optional].includes(key)) && required.every((key) => Object.hasOwn(value, key));
const sameText = (left: string, right: string) => left.normalize("NFC") === right.normalize("NFC");
const includesText = (whole: string, part: string) => whole.normalize("NFC").includes(part.normalize("NFC"));
const normalized = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function sourceFor(reference: GroundedTextReference, input: PlannerInput) { return input.recentSpeech.find((turn) => turn.id === reference.segmentId); }
function groundedText(value: unknown, input: PlannerInput): value is GroundedTextReference {
  return record(value) && exactKeys(value, ["segmentId", "text"]) && string(value.segmentId) && string(value.text) && includesText(sourceFor(value as GroundedTextReference, input)?.text ?? "", value.text);
}

function rewriteIsAuthorized(source: GroundedTextReference, displayText: string) {
  return CUECAPTION_SYMBOLIC_REWRITES.some((rewrite) => sameText(rewrite.sourceText, source.text) && sameText(rewrite.displayText, displayText));
}

function sanitizeEvidence(value: unknown, input: PlannerInput): LiveDecisionEvidence | undefined {
  if (value === undefined) return undefined;
  if (!record(value) || !optionalKeys(value, [], ["protected", "rewrites", "warnings"])) return undefined;
  const protectedRefs = Array.isArray(value.protected) ? value.protected.filter((item): item is GroundedTextReference => groundedText(item, input)) : value.protected === undefined ? undefined : [];
  const rewrites = Array.isArray(value.rewrites) ? value.rewrites.filter((item): item is { source: GroundedTextReference; displayText: string } => record(item) && exactKeys(item, ["source", "displayText"]) && groundedText(item.source, input) && string(item.displayText) && rewriteIsAuthorized(item.source, item.displayText)) : value.rewrites === undefined ? undefined : [];
  const warnings = Array.isArray(value.warnings) ? value.warnings.filter((item): item is { code: "ASR_AMBIGUITY" | "MISSING_STRUCTURE" | "MISSING_REFERENCE" | "MISSING_REACTION_FACT" | "POSSIBLE_TEACHER_ERROR" | "CONTEXT_CONFLICT"; target?: GroundedTextReference } => record(item) && optionalKeys(item, ["code"], ["target"]) && string(item.code) && warningCodes.has(item.code) && (item.target === undefined || groundedText(item.target, input))) : value.warnings === undefined ? undefined : [];
  return { ...(protectedRefs?.length ? { protected: protectedRefs } : {}), ...(rewrites?.length ? { rewrites } : {}), ...(warnings?.length ? { warnings } : {}) };
}

function fragmentsProtectedPhrase(reference: GroundedTextReference, evidence: LiveDecisionEvidence | undefined) {
  const target = normalized(reference.text);
  return evidence?.protected?.some((phrase) => {
    const protectedText = normalized(phrase.text);
    return phrase.segmentId === reference.segmentId && protectedText.includes(target) && protectedText !== target;
  }) ?? false;
}

function warningBlocks(reference: GroundedTextReference, evidence: LiveDecisionEvidence | undefined) {
  return evidence?.warnings?.some((warning) => !warning.target || (warning.target.segmentId === reference.segmentId && includesText(reference.text, warning.target.text))) ?? false;
}

function transformIsGrounded(from: GroundedTextReference, to: GroundedTextReference, input: PlannerInput) {
  const evidence = input.recentSpeech.filter((turn) => turn.id === from.segmentId || turn.id === to.segmentId).map((turn) => turn.text).join(" ");
  const transformLanguage = /\b(becomes?|turns? into|changes? (?:into|to)|transforms? (?:into|to)|rewrit(?:e|ten|es) (?:as|to)|converts? (?:into|to)|(?:is|are|was|were) converted (?:into|to))\b|→/i;
  const causalLanguage = /\b(causes?|gives?|means|leads? to|therefore|because|so)\b/i;
  return transformLanguage.test(evidence) && !causalLanguage.test(evidence);
}

function relationIsGrounded(relation: "cause" | "sequence" | "contrast", targets: GroundedTextReference[], input: PlannerInput) {
  const referencedIds = new Set(targets.map((target) => target.segmentId));
  const sourceText = input.recentSpeech.filter((turn) => referencedIds.has(turn.id)).map((turn) => turn.text).join(" ");
  if (relation === "cause") return /\b(because|causes?|caused by|leads? to|results? in|therefore|so that|consequently|due to|as a result)\b/i.test(sourceText);
  if (relation === "sequence") return /\b(first|firstly|then|next|after(?:wards)?|before|finally|subsequently|followed by|start by)\b/i.test(sourceText);
  return /\b(but|whereas|however|in contrast|compared (?:with|to)|on the other hand|different(?: from)?|unlike|rather than)\b/i.test(sourceText)
    || /\b(more|less|higher|lower)\b[^.!?]{0,80}\bthan\b/i.test(sourceText);
}

function learner(value: unknown, input: PlannerInput): LearnerIntent {
  if (!record(value) || !string(value.kind)) return { kind: "NONE" };
  if (value.kind === "NONE" && exactKeys(value, ["kind"])) return { kind: "NONE" };
  if ((value.kind === "NOTE" || value.kind === "REFLECT") && optionalKeys(value, ["kind"], ["target"]) && (value.target === undefined || groundedText(value.target, input))) return value as LearnerIntent;
  return { kind: "NONE" };
}

function knownQuiet(text: string) {
  return /^(?:okay|ok|right|so|um|uh|erm|well)[,.!\s]*(?:let'?s|we'?ll)?\s*(?:move on|continue|go on)?[.!\s]*$/i.test(text.trim());
}

/** Provider failures may only use known committed speech; this never reconstructs an untrusted relation. */
export function fallbackFromGroundedSpeech(input: PlannerInput): RuntimeDecision {
  const latest = input.recentSpeech.at(-1);
  if (!latest || knownQuiet(latest.text)) return { display: { kind: "QUIET", reason: latest ? "transition" : "insufficient-evidence" }, learner: { kind: "NONE" } };
  return { display: { kind: "TEXT" }, learner: { kind: "NONE" } };
}

/** Invalid semantic structure degrades to the current canonical span, never an inferred anchor. */
function currentSpanText(input: PlannerInput): RuntimeDecision {
  return input.recentSpeech.at(-1)
    ? { display: { kind: "TEXT" }, learner: { kind: "NONE" } }
    : quiet("insufficient-evidence");
}

function quiet(reason: "filler" | "transition" | "repetition" | "unfinished" | "insufficient-evidence"): RuntimeDecision { return { display: { kind: "QUIET", reason }, learner: { kind: "NONE" } }; }

/** Validates grounding, preserves authorized FX-only rewrites, and deterministically degrades unsafe structure. */
export function validateRuntimeDecision(value: unknown, input: PlannerInput): ValidationResult {
  if (!input.recentSpeech.length) return { ok: false, error: "Planner input has no committed speech." };
  if (!record(value) || !optionalKeys(value, ["display", "learner"], ["evidence"])) return { ok: true, decision: fallbackFromGroundedSpeech(input), degradation: "invalid-decision" };
  const evidence = sanitizeEvidence(value.evidence, input);
  const display = record(value.display) ? value.display : undefined;
  const learnerIntent = learner(value.learner, input);
  const finish = (displayIntent: DisplayIntent, learnerValue = learnerIntent): RuntimeDecision => ({ display: displayIntent, learner: learnerValue, ...(evidence && Object.keys(evidence).length ? { evidence } : {}) });
  if (!display || !string(display.kind)) return { ok: true, decision: fallbackFromGroundedSpeech(input), degradation: "invalid-decision" };
  if (display.kind === "QUIET" && exactKeys(display, ["kind", "reason"]) && string(display.reason) && quietReasons.has(display.reason)) return { ok: true, decision: finish(display as DisplayIntent) };
  if (display.kind === "TEXT") {
    if (exactKeys(display, ["kind"])) return { ok: true, decision: finish(display as DisplayIntent) };
    return { ok: true, decision: currentSpanText(input), degradation: "invalid-text" };
  }
  if (display.kind === "FOCUS") {
    if (exactKeys(display, ["kind", "target"]) && groundedText(display.target, input) && !fragmentsProtectedPhrase(display.target, evidence)) return { ok: true, decision: finish(display as DisplayIntent) };
    return { ok: true, decision: currentSpanText(input), degradation: "invalid-focus" };
  }
  if (display.kind === "RELATE") {
    const targets = Array.isArray(display.targets) ? display.targets : [];
    const validRelation = display.relation === "cause" || display.relation === "sequence" || display.relation === "contrast";
    const uniqueTargets = new Set(targets.map((target) => record(target) && string(target.segmentId) && string(target.text) ? `${target.segmentId}\u0000${target.text.normalize("NFC")}` : undefined));
    const valid = exactKeys(display, ["kind", "relation", "targets"]) && validRelation && targets.length >= 2 && targets.length <= 6 && uniqueTargets.size === targets.length && !uniqueTargets.has(undefined) && targets.every((target) => groundedText(target, input) && !fragmentsProtectedPhrase(target, evidence) && !warningBlocks(target, evidence)) && relationIsGrounded(display.relation as "cause" | "sequence" | "contrast", targets as GroundedTextReference[], input);
    if (valid) return { ok: true, decision: finish(display as DisplayIntent) };
    return { ok: true, decision: currentSpanText(input), degradation: "invalid-relation" };
  }
  if (display.kind === "TRANSFORM") {
    const valid = exactKeys(display, ["kind", "from", "to"]) && groundedText(display.from, input) && groundedText(display.to, input) && `${display.from.segmentId}:${display.from.text}` !== `${display.to.segmentId}:${display.to.text}` && !warningBlocks(display.from, evidence) && !warningBlocks(display.to, evidence) && transformIsGrounded(display.from, display.to, input);
    if (valid) return { ok: true, decision: finish(display as DisplayIntent) };
    return { ok: true, decision: currentSpanText(input), degradation: "invalid-transform" };
  }
  return { ok: true, decision: fallbackFromGroundedSpeech(input), degradation: "invalid-decision" };
}
