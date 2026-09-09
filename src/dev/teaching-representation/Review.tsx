import { useCallback, useEffect, useMemo, useState } from 'react';
import Canvas, { type CanvasEvidence } from './Canvas.tsx';
import { LESSON } from './lesson.ts';
import { produce, project, projectionErrors, visibleCatalog, type Production } from './producer.ts';
import { compareAI, type AIRow } from './ai.ts';
import './teaching-representation.css';

export default function Review() {
  const [index, setIndex] = useState(0), [playing, setPlaying] = useState(false), [diagnostic, setDiagnostic] = useState(false), [epoch, setEpoch] = useState(0);
  const [evidence, setEvidence] = useState<CanvasEvidence>();
  const [producer, setProducer] = useState<'GOLD' | 'AI'>('GOLD');
  const [aiRows, setAIRows] = useState<AIRow[]>([]), [aiBusy, setAIBusy] = useState(false), [aiError, setAIError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/dev/teaching-representation', { signal: controller.signal }).then(r => r.json()).then(r => setAIRows(r.rows ?? [])).catch(() => {});
    return () => controller.abort();
  }, []);
  const runAI = async () => {
    setAIBusy(true); setAIError('');
    try { const response = await fetch('/api/dev/teaching-representation', { method: 'POST' }); const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'AI comparison failed');
      setAIRows(result.rows); setProducer('AI');
    } catch (e) { setAIError(e instanceof Error ? e.message : String(e)); }
    finally { setAIBusy(false); }
  };
  const sequence = useMemo(() => {
    let previous: ReturnType<typeof project> | undefined;
    return LESSON.map(step => { const production = produce(step); const projection = project(step, production, previous); previous = projection;
      return { step, production, projection, errors: projectionErrors(step, production, projection) }; });
  }, []);
  const aiSequence = useMemo(() => aiRows.length ? compareAI(aiRows, LESSON) : [], [aiRows]);
  const renderedSequence = useMemo(() => {
    let history: Production | undefined;
    return (producer === 'AI' && aiSequence.length ? aiSequence : sequence).map(current => {
      history = visibleCatalog(current.step, current.production, current.projection, history);
      return { ...current, visibleProduction: history };
    });
  }, [producer, aiSequence, sequence]);
  const current = renderedSequence[index];
  const aiCurrent = producer === 'AI' ? aiSequence[index] : undefined;
  const record = useCallback((next: CanvasEvidence) => setEvidence(next), []);
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => { if (index === LESSON.length - 1) setPlaying(false); else setIndex(index + 1); }, 3500);
    return () => clearTimeout(timer);
  }, [playing, index]);
  useEffect(() => {
    Object.assign(window, { __teachingReview: { checkpoint: current.step.id, index, producer, ...current, evidence } });
  }, [current, index, evidence, producer]);
  return <main className="tr-spike">
    <header className="tr-toolbar"><strong>CueLayer</strong><span>Teaching representation · development</span>
      <label>Producer: <select aria-label="Producer" value={producer} onChange={e => setProducer(e.target.value as 'GOLD' | 'AI')}><option>GOLD</option><option disabled={!aiRows.length}>AI</option></select></label>
      <button disabled={aiBusy} onClick={runAI}>{aiBusy ? 'AI comparison running…' : aiRows.length ? 'Run AI again' : 'Run AI comparison'}</button>
      <button onClick={() => setDiagnostic(d => !d)}>{diagnostic ? 'Teaching view' : 'Diagnostic view'}</button>
    </header>
    <Canvas key={epoch} step={current.step} production={current.visibleProduction} projection={current.projection} onEvidence={record} />
    <footer className="tr-controls"><span>{index + 1}/{LESSON.length} · {current.step.time} · {current.step.title}{aiCurrent?.fallback ? ' · AI fallback (details in diagnostics)' : ''}{aiError ? ` · ${aiError}` : ''}</span>
      <nav aria-label="Lesson playback"><button onClick={() => { setIndex(0); setPlaying(false); setEpoch(e => e + 1); }}>Reset</button>
        <button disabled={!index} onClick={() => setIndex(i => i - 1)}>Previous</button>
        <button disabled={index === LESSON.length - 1} onClick={() => setIndex(i => i + 1)}>Next</button>
        <button onClick={() => setPlaying(p => !p)}>{playing ? 'Pause' : 'Play'}</button></nav>
    </footer>
    {diagnostic && <aside className="tr-diagnostics" aria-label="Teaching diagnostics">
      <h2>Accepted teaching and presentation</h2>
      <p>Synthetic teacher evidence: {current.step.speech}</p>
      <p>currentCoreId: {current.step.state.knowledge.currentCoreId}</p>
      <p>Producer: {producer} · Grounding: {current.production.errors.length + current.errors.length ? 'proposal rejected; grounded fallback' : 'valid'} · {current.projection.transition.knowledge} / {current.projection.transition.framing} / {current.projection.transition.representation}</p>
      {current.production.warnings.map(w => <p key={w}>{w}</p>)}
      <pre>{JSON.stringify({ activeCandidates: current.projection.attention.representations, candidates: current.production.candidates,
        payloads: current.production.registry, acceptedCoreRefs: current.step.refs, groundingErrors: [...current.errors, ...current.production.errors],
        homeVsPresentation: evidence, rawAIProposal: aiCurrent?.row, fallback: aiCurrent?.fallback,
        comparison: aiSequence.map(r => ({ checkpoint: r.step.id, ...r.metrics, errors: r.errors })) }, null, 2)}</pre>
    </aside>}
  </main>;
}
