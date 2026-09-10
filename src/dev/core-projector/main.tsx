import { createRoot } from 'react-dom/client';
import { useCallback, useState } from 'react';
import { CoreLiveSession } from '../../lesson-stream/core/live-session.ts';
import { PresentationStage } from '../../session/PresentationStage.tsx';
import type { CanvasEvidence } from '../../canvas-spatial/Canvas.tsx';
import type { AttentionPlan } from '../../learner-projection/production.ts';
import type { SessionTraceDraft } from '../../trace/contracts.ts';
import { INITIAL, REVISED, WITHDRAW, OTHER, RETURN, closedSpan, reviewContext, reviewInterpreter } from './scenario.ts';
import '../../session.css';
import './review.css';

const traces: SessionTraceDraft[] = [];
const trace = (draft: SessionTraceDraft) => { traces.push(draft); };
const live = await CoreLiveSession.open({ lessonDomain: 'core', sessionId: `m4c-review-${crypto.randomUUID()}`, speechRunId: 'review',
  interpreter: reviewInterpreter, contextOptions: reviewContext, trace });
window.addEventListener('pagehide', () => live.close(), { once: true });
function Review() {
  const [attention, setAttention] = useState<AttentionPlan>();
  const [evidence, setEvidence] = useState<CanvasEvidence>();
  const [count, setCount] = useState(0), [error, setError] = useState('');
  const inspect = useCallback((value: CanvasEvidence) => setEvidence(value), []);
  const accept = async (text: string) => {
    try {
      await live.commitClosedSpan(closedSpan(`span-${count}`, text)); await live.currentAttempt;
      if (live.health.error) throw new Error(live.health.error);
      setCount(n => n + 1); setError('');
    } catch (error) { setError(String(error)); }
  };
  const frame = (framing: 'FOCUS' | 'COMPARE' | 'WIDEN') => {
    const core = Object.values(live.state.knowledge.cores)[0];
    const refs = core ? Object.values(core.objects).filter(o => o.status === 'valid').map(o => ({ kind: 'OBJECT' as const, coreId: core.id, id: o.id })) : [];
    setAttention({ attention: { anchor: refs[0], emphasis: framing === 'COMPARE' ? refs.slice(0, 2) : refs.slice(0, 1),
      context: framing === 'WIDEN' ? refs.slice(1) : [], support: [] },
      transition: { knowledge: 'PRESERVE', framing, representation: framing === 'FOCUS' ? 'KEEP' : 'PAIR' }, projector: 'REFRAME_ATTENTION',
      parkedCoreIds: Object.keys(live.state.knowledge.cores).filter(id => id !== live.state.knowledge.currentCoreId) });
  };
  return <main className="core-review">
    <header><strong>Core shared projector review</strong><span>Local synthetic evidence · no external interpreter</span></header>
    <nav aria-label="Review controls">
      <button onClick={() => void accept(INITIAL)} disabled={count > 0}>Accept teaching</button>
      <button onClick={() => frame('FOCUS')} disabled={!count}>Focus</button>
      <button onClick={() => void accept(REVISED)} disabled={!count}>Revise content</button>
      <button onClick={() => frame('COMPARE')} disabled={!count}>Compare</button>
      <button onClick={() => frame('WIDEN')} disabled={!count}>Widen</button>
      <button onClick={() => void accept(WITHDRAW)} disabled={!count}>Withdraw first</button>
      <button onClick={() => { setAttention(undefined); void accept(OTHER); }} disabled={!count}>New mainline</button>
      <button onClick={() => { setAttention(undefined); void accept(RETURN); }} disabled={!count}>Return mainline</button>
    </nav>
    <PresentationStage stream={null} presentationStatus="empty" sessionStatus="active" speech={{ finals: [], spans: [] }} speechStatus="off" showSpeechDebug={false}
      coreTeaching={{ source: live.runtime, attention, onTrace: trace, onEvidence: inspect }} />
    <details><summary>Review diagnostics · accepted revision {live.state.knowledge.revision}</summary>
      <pre id="core-review-evidence">{JSON.stringify({ state: live.state, evidence, traces }, null, 2)}</pre>
    </details>
    {error && <p role="alert">Semantic acceptance failed: {error}</p>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Review />);
