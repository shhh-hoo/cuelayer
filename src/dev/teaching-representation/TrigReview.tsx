import { useCallback, useEffect, useMemo, useState } from 'react';
import Canvas, { type CanvasEvidence } from './Canvas.tsx';
import { TRIG_LESSON } from './trig-lesson.ts';
import { produceTrig, projectTrig, TRIG_IDS } from './trig-producer.ts';
import { trigCanvasCatalog } from './trig-canvas.ts';
import { projectionErrors, type Production } from './producer.ts';
import './teaching-representation.css';

export default function TrigReview() {
  const [index, setIndex] = useState(0), [diagnostic, setDiagnostic] = useState(false), [epoch, setEpoch] = useState(0);
  const [evidence, setEvidence] = useState<CanvasEvidence>();
  const sequence = useMemo(() => {
    let previous: ReturnType<typeof projectTrig> | undefined;
    const seen = new Set<string>();
    return TRIG_LESSON.map(step => {
      const production = produceTrig(step), projection = projectTrig(step, production, previous); previous = projection;
      projection.attention.representations.forEach(r => seen.add(r.id));
      // Only previously selected artifacts persist, regenerated from the latest
      // accepted snapshot. No stale historical payload is reused after rejection.
      const visibleProduction: Production = { ...production, registry: Object.fromEntries(Object.entries(production.registry).filter(([id]) => seen.has(id))) };
      return { step, production, projection, visibleProduction, errors: projectionErrors(step, production, projection) };
    });
  }, []);
  const current = sequence[index];
  const record = useCallback((next: CanvasEvidence) => setEvidence(next), []);
  useEffect(() => { Object.assign(window, { __trigReview: { index, ...current, evidence } }); }, [index, current, evidence]);
  const plot = current.production.registry[TRIG_IDS.plot];
  return <main className="tr-spike">
    <header className="tr-toolbar"><strong>CueLayer</strong><span>Teaching representation · Mathematics holdout · GOLD only · development</span>
      <button onClick={() => setDiagnostic(d => !d)}>{diagnostic ? 'Teaching view' : 'Diagnostic view'}</button></header>
    <Canvas key={epoch} step={current.step} production={current.visibleProduction} projection={current.projection} catalogFor={trigCanvasCatalog} onEvidence={record} />
    <footer className="tr-controls"><span>{index + 1}/7 · {current.step.time} · {current.step.title}</span><nav aria-label="Lesson playback">
      <button onClick={() => { setIndex(0); setEpoch(e => e + 1); }}>Reset</button>
      <button disabled={!index} onClick={() => setIndex(i => i - 1)}>Previous</button><button disabled={index === 6} onClick={() => setIndex(i => i + 1)}>Next</button>
    </nav></footer>
    {diagnostic && <aside className="tr-diagnostics" aria-label="Teaching diagnostics"><h2>Mathematics grounding and identity</h2>
      <p>GOLD · {current.production.errors.length + current.errors.length ? 'Rejected' : 'Grounding valid'} · {current.projection.transition.framing} / {current.projection.transition.representation}</p>
      <p>Stable plot: {plot?.id ?? 'not introduced'} · {plot?.kind === 'PLOT' && plot.plotKind === 'FUNCTION_2D' ? plot.functions.length : 0} accepted curves · Authored development fixture placement · No AI endpoint</p>
      <table><thead><tr><th>Candidate identity</th><th>Grounded objects / relations</th><th>Evidence</th></tr></thead><tbody>
        {Object.values(current.production.registry).map(p => <tr key={p.id}><td>{p.id}</td><td>{p.semanticRefs.length} / {p.relationRefs.length}</td><td>{p.evidenceCheckpointIds.join(', ')}</td></tr>)}
      </tbody></table>
      <details><summary>Exact accepted refs, payloads and home / presentation geometry</summary><pre>{JSON.stringify({ ...current, evidence }, null, 2)}</pre></details>
    </aside>}
  </main>;
}
