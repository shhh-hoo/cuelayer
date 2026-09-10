import { useCallback, useMemo, useState } from 'react';
import { Canvas, type CanvasEvidence } from '../../canvas-spatial/Canvas.tsx';
import { emptyArtifactRuntime, reconcileArtifacts } from '../../teaching-representation/artifact-runtime.ts';
import { CHEMISTRY_STORY, MATH_STORY, capabilities, produceFixture, projectFixture } from './fixtures.ts';
import './review.css';
import '../../representation-capabilities/representations.css';

export function Review() {
  const subject = new URLSearchParams(location.search).get('lesson') === 'math' ? 'math' : 'chemistry';
  const story = subject === 'math' ? MATH_STORY : CHEMISTRY_STORY;
  const records = useMemo(() => {
    let runtime = emptyArtifactRuntime(story[0].state.sessionId), previous: ReturnType<typeof projectFixture> | undefined;
    return story.map(step => {
      const production = produceFixture(step, subject), projection = projectFixture(step, subject, production, previous);
      const result = reconcileArtifacts(runtime, step.state, { checkpoints: step.checkpoints }, production, projection, capabilities);
      runtime = result.runtime; previous = projection;
      return { step, production, projection, ...result };
    });
  }, [story, subject]);
  const [index, setIndex] = useState(0), [diagnostics, setDiagnostics] = useState(false), [inspection, setInspection] = useState(false);
  const [evidence, setEvidence] = useState<CanvasEvidence>(), [widthAdjustments, setWidths] = useState<Record<string, number>>({});
  const onEvidence = useCallback((value: CanvasEvidence) => setEvidence(value), []);
  const onInspect = useCallback(() => setInspection(true), []);
  const record = records[index];
  const detail = { checkpoint: record.step.id, acceptedRefs: record.step.refs, semanticRevisions: { knowledge: record.step.state.knowledge.revision, cue: record.step.state.cue.revision },
    candidates: record.production.candidates, payloads: [...record.production.payloads.values()], selected: record.projection,
    artifacts: [...record.runtime.artifacts.values()].map(({ fingerprint: _fingerprint, ...artifact }) => artifact), changes: record.changes,
    diagnostics: [...record.production.diagnostics, ...record.diagnostics], canvas: evidence };
  return <main className="review-shell">
    <header className="review-controls">
      <a href="?lesson=chemistry">Chemistry</a><a href="?lesson=math">Mathematics</a>
      <button onClick={() => setIndex(n => Math.max(0, n - 1))} disabled={!index}>Previous</button>
      <select aria-label="Teaching checkpoint" value={index} onChange={event => setIndex(Number(event.target.value))}>
        {story.map((step, i) => <option key={step.id} value={i}>{i + 1}. {step.title}</option>)}
      </select>
      <button onClick={() => setIndex(n => Math.min(story.length - 1, n + 1))} disabled={index === story.length - 1}>Next</button>
      <button onClick={() => setInspection(false)}>Follow teaching</button>
      <button aria-pressed={diagnostics} onClick={() => setDiagnostics(v => !v)}>Review diagnostics</button>
    </header>
    <div className="review-caption"><span>{subject === 'math' ? 'Sine transformations' : 'Catalyst & reaction rate'}</span><span>{index + 1} / {story.length} · {record.projection.transition.framing}{inspection ? ' · Teacher inspection' : ''}</span></div>
    <div className="review-projector"><Canvas runtime={record.runtime} state={record.step.state} registry={capabilities} projection={record.projection}
      inspection={inspection} onInspect={onInspect} widthAdjustments={widthAdjustments} onEvidence={onEvidence} /></div>
    {diagnostics && <aside className="review-diagnostics" aria-label="Architecture review diagnostics">
      <div><strong>Architecture inspection</strong><button onClick={() => setDiagnostics(false)}>Close diagnostics</button>
        <button onClick={() => {
          const id = [...record.runtime.artifacts.values()].find(a => a.visible)?.id;
          if (id) setWidths(w => ({ ...w, [id]: (w[id] ?? 0) + 120 }));
        }}>Grow selected artifact</button><button onClick={() => setWidths({})}>Reset measured widths</button></div>
      <p>Accepted GOLD replay · no provider calls. Growth changes measured UI width. Drag or wheel on the projector to inspect; Follow teaching restores the latest camera.</p>
      <pre id="architecture-evidence">{JSON.stringify(detail, null, 2)}</pre>
    </aside>}
    <script type="application/json" id="review-evidence">{JSON.stringify(detail)}</script>
  </main>;
}
