import type { CoreLiveOptions } from '../../lesson-stream/core/live-session.ts';
import type { SemanticReference } from '../../lesson-stream/core/contracts.ts';
import { closedSpan, proposalFor, proposedStep } from '../../lesson-stream/core/live-test-fixtures.ts';

export { closedSpan };
export const INITIAL = 'Reservoir A stores water. Valve B controls the outlet. Sensor C measures the level.';
export const REVISED = 'Reservoir A stores water and releases it through the outlet when the valve opens. The level falls as water leaves.';
export const WITHDRAW = 'Withdraw the reservoir statement; it is no longer valid.';
export const OTHER = 'A separate circuit supplies the indicator lamp.';
export const RETURN = 'Return to the reservoir and valve.';

/** Synthetic evidence + injected deterministic proposal transport, through the
 * real Core scheduler/validation/persistence. No GOLD accepted snapshots. */
export const reviewContext: CoreLiveOptions['contextOptions'] = base => ({
  required: Object.values(base.state.knowledge.cores).map(core => ({ kind: 'CORE', id: core.id })),
  writable: Object.values(base.state.knowledge.cores).flatMap(core => Object.keys(core.objects)
    .map(id => ({ kind: 'OBJECT' as const, coreId: core.id, id }))),
});
export const reviewInterpreter: CoreLiveOptions['interpreter'] = async binding => {
  const proposal = proposalFor(binding), step = proposedStep(proposal);
  const text = binding.context.evidence.find(e => e.consumption === 'new')!.text;
  const provenance = { speech: [step.consumes[0]], state: [], domain: null };
  const firstCore = Object.values(binding.base.state.knowledge.cores)[0];
  const firstObject = firstCore && Object.values(firstCore.objects)[0];
  const existing = (target: SemanticReference) => {
    const handle = [...binding.entities].find(([, entry]) => entry.target.kind === target.kind && entry.target.id === target.id)?.[0];
    if (!handle) throw new Error('review-reference-not-projected');
    return { existing: handle };
  };
  if (text === INITIAL || text === OTHER) {
    step.knowledgeOps = [{ action: 'CREATE_CORE', as: 'main', provenance },
      ...((text === INITIAL ? ['Reservoir A stores water.', 'Valve B controls the outlet.', 'Sensor C measures the level.'] : [OTHER]).map((text, index) => ({
        action: 'ADD_OBJECT' as const, core: { created: 'main' }, as: `object_${index}`, value: { text, provenance },
      }))), { action: 'SET_CURRENT_CORE', core: { created: 'main' } }];
  } else if (text === RETURN) {
    step.knowledgeOps = [{ action: 'SET_CURRENT_CORE', core: existing({ kind: 'CORE', id: firstCore.id }) }];
  } else {
    const target = existing({ kind: 'OBJECT', coreId: firstCore.id, id: firstObject.id });
    step.knowledgeOps = text === WITHDRAW
      ? [{ action: 'INVALIDATE', target, correctionEvidence: step.consumes[0] }]
      : [{ action: 'REVISE_OBJECT', target, value: { text, provenance }, correctionEvidence: null }];
  }
  return proposal;
};
