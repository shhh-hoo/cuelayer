import { z } from 'zod';
import type { CoreTeachingState, SemanticReference } from '../../lesson-stream/core/contracts.ts';
import { resolveSemanticReference } from '../../lesson-stream/core/teaching-state.ts';
import { learnerProjectionFixtureErrors, type LearnerProjection, type ProjectionCandidate, type RepresentationKind } from '../../learner-projection/contracts.ts';
import { RELATIONS, WORDS, type LessonStep } from './lesson.ts';
import type { FunctionPlot, TrigEquation } from './trig-payload.ts';

export const KINDS = ['PROPOSITION', 'RELATION_CHAIN', 'EQUATION', 'PLOT', 'COMPARE'] as const;
export type PayloadKind = typeof KINDS[number];
export const planSchema = z.object({ candidates: z.array(z.object({
  candidateKind: z.enum(KINDS), candidateId: z.string().regex(/^[a-z][a-z0-9-]{0,99}$/).refine(id => !['constructor', 'prototype'].includes(id)),
  semanticRefs: z.array(z.string()).min(1).max(16), relationRefs: z.array(z.string()).max(12),
}).strict()).max(12) }).strict();
export type CandidatePlan = z.infer<typeof planSchema>['candidates'][number];
type Grounding = { id: string; semanticRefs: SemanticReference[]; relationRefs: SemanticReference[]; evidenceCheckpointIds: string[] };
export type TeachingPresentationPayload = Grounding & (
  | { kind: 'PROPOSITION'; object: SemanticReference }
  | { kind: 'RELATION_CHAIN'; nodes: SemanticReference[]; links: { ref: SemanticReference; from: SemanticReference; to: SemanticReference; connector: 'arrow' | 'neutral' }[] }
  | { kind: 'EQUATION'; equation: SemanticReference; format: 'ARRHENIUS' }
  | { kind: 'PLOT'; plotKind: 'ENERGY_PROFILE'; labels: Record<string, SemanticReference> }
  | TrigEquation | FunctionPlot
  | { kind: 'COMPARE'; targets: SemanticReference[] }
);
export type Production = { registry: Record<string, TeachingPresentationPayload>; candidates: ProjectionCandidate[]; errors: string[]; warnings: string[] };
const representationKinds: Record<PayloadKind, RepresentationKind> = { PROPOSITION: 'TEXT', RELATION_CHAIN: 'DIAGRAM', EQUATION: 'MATH', PLOT: 'PLOT', COMPARE: 'DIAGRAM' };
export const IDS = { intro: 'catalyst-proposition', chain: 'catalyst-mechanism-chain', plot: 'catalyst-energy-profile', lower: 'catalyst-lower-energy', equation: 'arrhenius-equation', rate: 'arrhenius-consequence', compare: 'catalyst-arrhenius-compare' };
export function unit(state: CoreTeachingState, ref: SemanticReference | undefined) {
  if (!ref) return undefined;
  const value = resolveSemanticReference(state, ref);
  return value && 'status' in value && value.status === 'valid' ? value : undefined;
}
export const textOf = (state: CoreTeachingState, ref: SemanticReference) => unit(state, ref)?.value.text ?? '';
const plotKeys = ['reactants', 'products', 'uncatalysed', 'catalysed', 'progress', 'energy', 'ea', 'endpoints', 'exothermic'] as const;
const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id));
const plan = (step: LessonStep, kind: PayloadKind, id: string, objects: string[], relations: string[] = []): CandidatePlan => ({
  candidateKind: kind, candidateId: id, semanticRefs: objects.map(key => step.refs[key].id), relationRefs: relations.map(key => step.refs[key].id),
});

/** GOLD is authored form choice over the accepted snapshot, never a model call.
 * The mechanism's identity persists while its accepted node/edge set grows or
 * shrinks. A genuinely different artifact (plot/equation/compare) has a new ID.
 */
export function goldPlans(step: LessonStep): CandidatePlan[] {
  const valid = (key: string) => Boolean(unit(step.state, step.refs[key]));
  const plans = [plan(step, 'PROPOSITION', IDS.intro, ['definition'])];
  if (valid('pathway')) {
    const nodes = ['pathway']; const links: string[] = [];
    for (const [object, relation] of [['lower', 'lowersRelation'], ['fraction', 'fractionRelation'], ['rate', 'rateRelation']]) {
      if (!valid(object) || !valid(relation)) break;
      nodes.push(object); links.push(relation);
    }
    plans.push(plan(step, nodes.length > 1 ? 'RELATION_CHAIN' : 'PROPOSITION', IDS.chain, nodes, links));
  }
  if (plotKeys.every(valid) && valid('barrierRelation')) plans.push(plan(step, 'PLOT', IDS.plot, [...plotKeys], ['barrierRelation']));
  if (valid('lower')) plans.push(plan(step, 'PROPOSITION', IDS.lower, ['lower']));
  if (valid('equation')) plans.push(plan(step, 'EQUATION', IDS.equation, ['equation']));
  if (valid('consequence')) {
    plans.push(plan(step, 'PROPOSITION', IDS.rate, ['consequence']));
    if (step.intent === 'COMPARE') plans.push(plan(step, 'COMPARE', IDS.compare, ['lower', 'consequence']));
  }
  return plans;
}

/** Validates the entire payload, not just M4A's optional single target. Every
 * factual string comes from an accepted unit. Plot/equation grammar is a small
 * reviewed renderer capability, gated by exact accepted meaning in this spike.
 */
export function buildPayload(step: LessonStep, proposal: CandidatePlan): TeachingPresentationPayload {
  const all = Object.values(step.refs);
  const refs = (ids: string[], kind: 'OBJECT' | 'RELATION') => ids.map(id => {
    const ref = all.find(ref => ref.id === id && ref.kind === kind);
    if (!ref || !unit(step.state, ref)) throw new Error(`invalid-${kind.toLowerCase()}-ref:${id}`);
    return ref;
  });
  const semanticRefs = refs(proposal.semanticRefs, 'OBJECT'), relationRefs = refs(proposal.relationRefs, 'RELATION');
  if (new Set(proposal.semanticRefs).size !== semanticRefs.length || new Set(proposal.relationRefs).size !== relationRefs.length) throw new Error('duplicate-grounding-ref');
  const evidenceCheckpointIds = [...new Set([...semanticRefs, ...relationRefs].flatMap(ref => unit(step.state, ref)!.value.provenance.speechRefs.map(s => s.checkpointId)))];
  if (!evidenceCheckpointIds.length || evidenceCheckpointIds.some(id => !step.checkpoints.some(cp => cp.checkpointId === id))) throw new Error('uncommitted-grounding');
  const base: Grounding = { id: proposal.candidateId, semanticRefs, relationRefs, evidenceCheckpointIds };
  if (proposal.candidateKind === 'PROPOSITION' || proposal.candidateKind === 'EQUATION') {
    if (semanticRefs.length !== 1 || relationRefs.length) throw new Error('single-object-required');
    if (proposal.candidateKind === 'PROPOSITION') return { ...base, kind: 'PROPOSITION', object: semanticRefs[0] };
    if (textOf(step.state, semanticRefs[0]) !== WORDS.equation) throw new Error('unsupported-equation-grammar');
    return { ...base, kind: 'EQUATION', equation: semanticRefs[0], format: 'ARRHENIUS' };
  }
  if (proposal.candidateKind === 'RELATION_CHAIN') {
    if (semanticRefs.length < 2 || relationRefs.length !== semanticRefs.length - 1) throw new Error('chain-needs-accepted-links');
    const links = relationRefs.map((ref, i) => {
      const relation = unit(step.state, ref)!;
      if ((!('fromObjectId' in relation.value) || !('toObjectId' in relation.value)) || relation.value.fromObjectId !== semanticRefs[i].id || relation.value.toObjectId !== semanticRefs[i + 1].id) throw new Error('chain-direction-mismatch');
      const causal = [RELATIONS.lowers, RELATIONS.fraction, RELATIONS.rate].includes(relation.value.text as never);
      return { ref, from: semanticRefs[i], to: semanticRefs[i + 1], connector: causal ? 'arrow' as const : 'neutral' as const };
    });
    return { ...base, kind: 'RELATION_CHAIN', nodes: semanticRefs, links };
  }
  if (proposal.candidateKind === 'COMPARE') {
    if (semanticRefs.length !== 2 || relationRefs.length || step.intent !== 'COMPARE'
      || !sameIds(proposal.semanticRefs, [step.refs.lower?.id, step.refs.consequence?.id])) throw new Error('compare-requires-co-primary-attention');
    return { ...base, kind: 'COMPARE', targets: semanticRefs };
  }
  const labels = Object.fromEntries(plotKeys.map(key => [key, step.refs[key]]));
  if (plotKeys.some(key => !labels[key] || textOf(step.state, labels[key]) !== WORDS[key])
    || !sameIds(proposal.semanticRefs, plotKeys.map(key => labels[key].id))
    || relationRefs.length !== 1 || relationRefs[0].id !== step.refs.barrierRelation?.id
    || textOf(step.state, relationRefs[0]) !== RELATIONS.barrier) throw new Error('energy-profile-not-grounded');
  const barrier = unit(step.state, relationRefs[0])!;
  if ((!('fromObjectId' in barrier.value) || !('toObjectId' in barrier.value)) || barrier.value.fromObjectId !== labels.catalysed.id || barrier.value.toObjectId !== labels.uncatalysed.id) throw new Error('barrier-direction-mismatch');
  return { ...base, kind: 'PLOT', plotKind: 'ENERGY_PROFILE', labels };
}

export function proseWarning(state: CoreTeachingState, payload: TeachingPresentationPayload): string[] {
  if (payload.kind !== 'PROPOSITION') return [];
  const text = textOf(state, payload.object);
  const related = Object.values(state.knowledge.cores).flatMap(core => Object.values(core.relations)).filter(r => r.status === 'valid'
    && (r.value.fromObjectId === payload.object.id || r.value.toObjectId === payload.object.id || text.includes(r.value.text)));
  return related.length >= 2 && (related.filter(r => text.includes(r.value.text)).length >= 2 || /[.!?].+[.!?].+[.!?]/.test(text))
    ? [`TEACHING REPRESENTATION WARNING: ${payload.id} compresses multiple accepted relations into prose; review a chain.`] : [];
}

export function produce(step: LessonStep, raw: unknown = { candidates: goldPlans(step) }, producer: 'GOLD' | 'AI' = 'GOLD'): Production {
  const registry: Production['registry'] = {}; const candidates: ProjectionCandidate[] = []; const errors: string[] = []; const warnings: string[] = [];
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) return { registry, candidates, errors: ['structured-output-invalid'], warnings };
  const seen = new Set<string>();
  for (const proposal of parsed.data.candidates) {
    try {
      if (seen.has(proposal.candidateId)) throw new Error('duplicate-candidate-id');
      seen.add(proposal.candidateId);
      const payload = buildPayload(step, proposal);
      registry[payload.id] = payload;
      candidates.push({ candidateType: 'REPRESENTATION', id: payload.id, representationKind: representationKinds[payload.kind],
        target: payload.semanticRefs[0], evidenceCheckpointIds: payload.evidenceCheckpointIds, producer: { skillId: `dev.teaching-representation.${producer.toLowerCase()}` } });
      warnings.push(...proseWarning(step.state, payload));
    } catch (error) { errors.push(`${proposal.candidateId}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  // Never silently salvage a partially invalid AI plan.
  return errors.length ? { registry: {}, candidates: [], errors, warnings } : { registry, candidates, errors, warnings };
}

/** Authored M4A attention fixture, not a new production governor. Producer form
 * suggestions never decide currentCoreId, semantic attention, or geometry.
 */
export function project(step: LessonStep, production: Production, previous?: LearnerProjection): LearnerProjection {
  const find = (id: string) => production.candidates.find(c => c.id === id);
  let ids: string[] = [];
  switch (step.intent) {
    case 'PLOT': ids = [IDS.plot]; break;
    case 'PAIR': ids = [IDS.chain, IDS.plot]; break;
    case 'EQUATION': ids = [IDS.equation]; break;
    case 'RATE': ids = [IDS.rate, IDS.equation]; break;
    case 'WIDEN': ids = [IDS.rate, IDS.lower]; break;
    case 'COMPARE': ids = [IDS.compare]; break;
    case 'TANGENT': ids = previous?.attention.representations.map(r => r.id) ?? [IDS.chain, IDS.plot]; break;
    default: ids = [find(IDS.chain) ? IDS.chain : IDS.intro];
  }
  // Select by exact authored artifact identity, then allow a differently named
  // grounded form for the same semantic target. Unrelated candidates get no attention.
  const expected = new Map(goldPlans(step).map(p => [p.candidateId, p.semanticRefs[0]]));
  const selected = ids.flatMap(id => {
    const named = find(id);
    const candidate = named?.candidateType === 'REPRESENTATION' && named.target?.id === expected.get(id) ? named
      : production.candidates.find(c => c.candidateType === 'REPRESENTATION' && c.target?.id === expected.get(id));
    return candidate && candidate.candidateType === 'REPRESENTATION' ? [candidate] : [];
  }).filter((c, i, all) => all.findIndex(other => c.id === other.id) === i);
  const representations = selected.map((candidate, index) => ({ id: candidate.id, kind: candidate.representationKind,
    role: index === 0 ? 'dominant' as const : 'companion' as const, target: candidate.target }));
  const anchor = step.intent === 'WIDEN' ? step.refs.consequence : step.intent === 'COMPARE' ? step.refs.lower
    : Object.values(step.refs).find(ref => ref.id === expected.get(ids[0])) ?? step.refs.definition;
  const same = JSON.stringify(previous?.attention.representations) === JSON.stringify(representations);
  return {
    attention: { anchor, emphasis: step.intent === 'COMPARE' ? [step.refs.consequence] : [],
      context: step.intent === 'WIDEN' ? [step.refs.lower] : [], support: [], representations },
    transition: { knowledge: step.recentChanges.length ? 'ADVANCE' : 'PRESERVE',
      framing: step.intent === 'WIDEN' || step.intent === 'COMPARE' ? step.intent : 'FOCUS',
      representation: same ? 'KEEP' : representations.length > 1 ? 'PAIR' : 'SWITCH' },
    projector: step.intent === 'TANGENT' ? 'PRESERVE_VIEW' : 'REFRAME_ATTENTION',
    parkedCoreIds: Object.keys(step.state.knowledge.cores).filter(id => id !== step.state.knowledge.currentCoreId),
  };
}
/** Only M4A-selected artifacts enter presentation history. An offered candidate
 * never becomes visible merely because it exists. Revalidate historical payloads
 * at every checkpoint, including PRESERVE, before rendering their latest version.
 */
export function visibleCatalog(step: LessonStep, production: Production, projection: LearnerProjection, previous?: Production): Production {
  const selected = new Set(projection.attention.representations.map(r => r.id));
  const ids = new Set([...Object.keys(previous?.registry ?? {}), ...selected]);
  const registry: Production['registry'] = {};
  for (const id of ids) {
    const payload = production.registry[id] ?? previous?.registry[id];
    if (!payload || (payload.kind === 'COMPARE' && !selected.has(id))) continue;
    const validation = produce(step, { candidates: [{ candidateId: id, candidateKind: payload.kind,
      semanticRefs: payload.semanticRefs.map(r => r.id), relationRefs: payload.relationRefs.map(r => r.id) }] });
    if (!validation.errors.length) registry[id] = payload;
  }
  return { ...production, registry };
}
export function projectionErrors(step: LessonStep, production: Production, projection: LearnerProjection) {
  return learnerProjectionFixtureErrors({ id: step.id, source: { family: 'RSC', title: 'Authored synthetic Catalyst story', url: 'https://edu.rsc.org/' },
    sequenceSummary: step.title, input: { state: step.state, recentChanges: step.recentChanges, candidates: production.candidates,
      committedEvidenceCheckpointIds: step.checkpoints.map(c => c.checkpointId), presentationMode: 'presentationless', viewport: { width: 1280, height: 720 } }, expected: projection, mustNot: [] });
}
