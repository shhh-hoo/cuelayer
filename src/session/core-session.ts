import { CoreLiveSession, type CoreLiveOptions } from '../lesson-stream/core/live-session';
import type { SemanticReference } from '../lesson-stream/core/contracts';
import { CORE_CONTEXT_BUDGETS } from '../lesson-stream/core/interpretation-context';
import { createHttpCoreInterpreter } from '../lesson-stream/core/http-interpreter';

/** Production host scope: recent accepted units in the current mainline may be revised.
 * The reviewed builder still owns closure, reference capabilities and all budgets. */
export const productionCoreContext: CoreLiveOptions['contextOptions'] = base => {
  const core = base.state.knowledge.currentCoreId && base.state.knowledge.cores[base.state.knowledge.currentCoreId];
  const writable: SemanticReference[] = core ? (['OBJECT', 'RELATION', 'SUPPORT'] as const).flatMap(kind =>
    Object.values(core[kind === 'OBJECT' ? 'objects' : kind === 'RELATION' ? 'relations' : 'supports'])
      .filter(unit => unit.status === 'valid').map(unit => ({ kind, coreId: core.id, id: unit.id })))
    .slice(-CORE_CONTEXT_BUDGETS.optionalRoots) : [];
  if (base.state.cue.active) writable.push({ kind: 'CUE', id: base.state.cue.active.id });
  return { writable };
};

/** The normal route and deterministic tests share this composition, never a second controller. */
export function openCoreSession(options: Pick<CoreLiveOptions, 'sessionId' | 'speechRunId' | 'trace'> & Partial<Pick<CoreLiveOptions, 'interpreter' | 'store' | 'verificationSink' | 'finalizationMs'>>) {
  return CoreLiveSession.open({ ...options, lessonDomain: 'core',
    interpreter: options.interpreter ?? createHttpCoreInterpreter(), contextOptions: productionCoreContext });
}
