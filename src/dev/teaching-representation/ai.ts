import type { LearnerProjection } from '../../learner-projection/contracts.ts';
import type { LessonStep } from './lesson.ts';
import { planSchema, produce, project, type CandidatePlan, type Production, type TeachingPresentationPayload } from './producer.ts';

export type AIRow = { checkpoint: string; raw: unknown; outputText?: string; elapsedMs: number; model?: string; responseId?: string; usage?: unknown; error?: string };
export const payloadPlan = (payload: TeachingPresentationPayload): CandidatePlan => ({ candidateId: payload.id, candidateKind: payload.kind,
  semanticRefs: payload.semanticRefs.map(r => r.id), relationRefs: payload.relationRefs.map(r => r.id) });

/** Previous output is revalidated against the NEW accepted snapshot before it
 * can remain visible. Any invalid new plan falls back as a whole, visibly. The
 * fallback can preserve grounded history or use exact-text propositions, never
 * an invisible GOLD repair of the AI's form choice.
 */
export function acceptAI(step: LessonStep, row: AIRow, previous?: Production, previousProjection?: LearnerProjection) {
  const history = Object.values(previous?.registry ?? {}).map(payloadPlan).filter(p => produce(step, { candidates: [p] }, 'AI').errors.length === 0);
  const parsed = planSchema.safeParse(row.raw);
  const fresh = produce(step, row.raw, 'AI');
  const hijacks = parsed.success ? parsed.data.candidates.filter(p => {
    const prior = previous?.registry[p.candidateId];
    return prior && prior.semanticRefs[0].id !== p.semanticRefs[0];
  }).map(p => `${p.candidateId}: candidate-identity-rebound`) : [];
  const errors = [...fresh.errors, ...hijacks, ...(row.error ? [row.error] : [])];
  const merged = new Map(history.map(p => [p.candidateId, p]));
  if (!errors.length && parsed.success) for (const p of parsed.data.candidates) merged.set(p.candidateId, p);
  let production = produce(step, { candidates: [...merged.values()] }, 'AI');
  let projection = project(step, production, previousProjection);
  let fallback = errors.length > 0;
  // A missing current target needs an honest simple presentation, particularly
  // on Core shift or after invalidation makes the previous artifact unusable.
  const expected = project(step, produce(step), previousProjection);
  const currentTargets = projection.attention.representations.map(r => r.target?.id);
  for (const intent of expected.attention.representations) {
    if (intent.target && !currentTargets.includes(intent.target.id)) {
      const p: CandidatePlan = { candidateId: intent.id, candidateKind: 'PROPOSITION', semanticRefs: [intent.target.id], relationRefs: [] };
      merged.set(p.candidateId, p); fallback = true;
    }
  }
  if (fallback) { production = produce(step, { candidates: [...merged.values()] }, 'AI'); projection = project(step, production, previousProjection); }
  return { production, projection, errors, fallback };
}

export function compareAI(rows: AIRow[], steps: LessonStep[]) {
  let previous: Production | undefined, previousProjection: LearnerProjection | undefined;
  let priorRaw: CandidatePlan[] = [];
  return steps.map((step, index) => {
    const row = rows.find(r => r.checkpoint === step.id) ?? { checkpoint: step.id, raw: undefined, elapsedMs: 0, error: 'AI run unavailable' };
    const accepted = acceptAI(step, row, previous, previousProjection);
    const gold = produce(step), goldProjection = project(step, gold, previousProjection);
    const parsed = planSchema.safeParse(row.raw);
    const rawPlans = parsed.success ? parsed.data.candidates : [];
    const actual = accepted.projection.attention.representations;
    const formMatches = goldProjection.attention.representations.filter(r => actual.some(a => a.target?.id === r.target?.id && a.kind === r.kind)).length;
    const neededRefs = new Set(goldProjection.attention.representations.map(r => r.target?.id));
    const unnecessary = rawPlans.filter(p => !neededRefs.has(p.semanticRefs[0])).length;
    const staleIds = new Set(priorRaw.map(p => p.candidateId));
    const candidateChurn = index ? rawPlans.filter(p => !staleIds.has(p.candidateId)).length + priorRaw.filter(p => !rawPlans.some(n => n.candidateId === p.candidateId)).length : 0;
    const stability = rawPlans.filter(p => priorRaw.some(old => old.candidateId === p.candidateId && old.candidateKind === p.candidateKind)).length;
    const result = { step, row, ...accepted, metrics: {
      representationFormMatches: accepted.errors.length ? 0 : formMatches, displayedFormMatches: formMatches, expectedForms: goldProjection.attention.representations.length,
      groundingValid: !accepted.errors.length, structuredOutputValid: parsed.success,
      unnecessaryRepresentations: unnecessary, proposedRepresentations: rawPlans.length,
      missedVisualOpportunities: goldProjection.attention.representations.filter(r => ['DIAGRAM', 'PLOT', 'MATH'].includes(r.kind) && !actual.some(a => a.target?.id === r.target?.id && a.kind === r.kind)).length,
      paragraphDumpWarnings: accepted.production.warnings.length, stableAdjacentArtifacts: stability, candidateChurn,
      latencyMs: row.elapsedMs, fallback: accepted.fallback,
    } };
    previous = accepted.production; previousProjection = accepted.projection; priorRaw = rawPlans;
    return result;
  });
}
export const currentAttention = (step: LessonStep) => {
  const gold = produce(step), projection = project(step, gold);
  return { intent: step.intent === 'TANGENT' ? 'PRESERVE' : projection.transition.framing,
    semanticAttention: { anchor: projection.attention.anchor, emphasis: projection.attention.emphasis, context: projection.attention.context },
    targets: projection.attention.representations.map(r => r.target), recentChanges: step.recentChanges };
};
