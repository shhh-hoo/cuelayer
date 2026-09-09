import { createElement, type ReactNode } from 'react';
import type { CoreTeachingState } from '../../lesson-stream/core/contracts.ts';
import { textOf, type TeachingPresentationPayload } from './producer.ts';
import { sampleSine, sineSchema } from './trig-payload.ts';

export function FunctionPlot({ state, payload }: { state: CoreTeachingState; payload: Extract<TeachingPresentationPayload, { plotKind: 'FUNCTION_2D' }> }) {
  const x = (value: number) => 54 + value / (2 * Math.PI) * 468;
  const y = (value: number) => 192 - value * 67;
  return <figure className="tr-function" data-payload-kind="PLOT" data-plot-kind="FUNCTION_2D" data-candidate-id={payload.id}>
    <svg viewBox="0 0 560 405" role="img" aria-label={payload.functions.map(f => textOf(state, f.expressionRef)).join('; ')}>
      {[-2, -1, 0, 1, 2].map(tick => <g key={tick}><path className="tr-function-grid" d={`M54 ${y(tick)} H522`} /><text x="40" y={y(tick) + 7} textAnchor="end">{tick}</text></g>)}
      {[0, Math.PI, 2 * Math.PI].map((tick, i) => <g key={i}><path className="tr-function-grid" d={`M${x(tick)} 48 V336`} />
        <text x={x(tick)} y="363" textAnchor="middle">{['0', 'π', '2π'][i]}</text></g>)}
      <path className="tr-function-axis" d="M54 40 V336 M54 192 H531" />
      <text x="54" y="27" data-semantic-id={payload.yAxis.id}>{textOf(state, payload.yAxis)}</text>
      <text x="295" y="400" textAnchor="middle" data-semantic-id={payload.xAxis.id}>{textOf(state, payload.xAxis)}</text>
      {payload.functions.map(f => <path key={f.expressionRef.id} className={`tr-curve tr-curve-${f.expression.amplitude === 2 ? 'amplitude' : f.expression.verticalShift ? 'shift' : 'base'}`}
        data-curve-ref={f.expressionRef.id} data-parameter-refs={f.parameterRefs.map(r => r.id).join(' ')} data-relationship-refs={f.relationshipRefs.map(r => r.id).join(' ')}
        d={sampleSine(f.expression).map((point, i) => `${i ? 'L' : 'M'}${x(point.x).toFixed(3)},${y(point.y).toFixed(3)}`).join(' ')} />)}
    </svg>
    <figcaption>{payload.functions.map(f => <span key={f.expressionRef.id} data-semantic-id={f.expressionRef.id}
      className={`tr-legend-${f.expression.amplitude === 2 ? 'amplitude' : f.expression.verticalShift ? 'shift' : 'base'}`}>{textOf(state, f.expressionRef)}</span>)}</figcaption>
  </figure>;
}

const m = (tag: string, ...children: ReactNode[]) => createElement(tag, null, ...children);
export function TrigEquation({ state, payload, comparing }: { state: CoreTeachingState; payload: Extract<TeachingPresentationPayload, { format: 'TRIG' }>; comparing: boolean }) {
  const expression = sineSchema.parse(payload.expression);
  return <section className="tr-trig-equation" data-payload-kind="EQUATION" data-candidate-id={payload.id}>
    <div className="tr-trig-label" data-semantic-id={payload.label.id}>{textOf(state, payload.label)}</div>
    <div className="tr-trig-math" data-semantic-id={payload.equation.id}>{createElement('math', { xmlns: 'http://www.w3.org/1998/Math/MathML', display: 'block', 'aria-label': textOf(state, payload.equation) },
      m('mi', 'y'), m('mo', '='), ...(expression.amplitude === 2 ? [m('mn', '2')] : []), m('mi', 'sin'), m('mi', 'x'),
      ...(expression.verticalShift === 1 ? [m('mo', '+'), m('mn', '1')] : []))}</div>
    {!comparing && payload.family && <div className="tr-trig-rule"><span data-semantic-id={payload.family.id}>{textOf(state, payload.family)}</span>
      {payload.rule && <span data-semantic-id={payload.rule.id}>{textOf(state, payload.rule)}</span>}</div>}
  </section>;
}
