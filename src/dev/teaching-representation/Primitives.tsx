import { createElement, type ReactNode } from 'react';
import type { CoreTeachingState, SemanticReference } from '../../lesson-stream/core/contracts.ts';
import { textOf, type TeachingPresentationPayload } from './producer.ts';

type Plot = Extract<TeachingPresentationPayload, { kind: 'PLOT' }>;
/** Fixed qualitative grammar, no data coordinates accepted from a producer.
 * Shared endpoints and exothermic ordering are explicitly grounded prerequisites.
 * Curve widths, smoothness and peak positions are illustrative, not kinetics data.
 */
export function EnergyProfile({ state, payload }: { state: CoreTeachingState; payload: Plot }) {
  const label = (key: string) => textOf(state, payload.labels[key]);
  const source = (key: string) => ({ 'data-semantic-id': payload.labels[key].id });
  return <figure className="tr-energy" data-payload-kind="PLOT" aria-label="Qualitative energy profile, not to scale">
    <svg viewBox="0 0 560 360" role="img" aria-label="The catalysed pathway has a lower activation-energy barrier; both pathways share their endpoints.">
      <path className="tr-axis" d="M58 25 V305 H535" />
      <text x="14" y="195" transform="rotate(-90 14 195)" {...source('energy')}>{label('energy')}</text>
      <text x="276" y="347" {...source('progress')}>{label('progress')}</text>
      <path className="tr-high" d="M70 254 C140 254 158 66 266 66 C375 66 398 287 505 287" />
      <path className="tr-low" d="M70 254 C140 254 170 178 266 178 C367 178 411 287 505 287" />
      <path className="tr-guide" d="M70 254 H280" />
      <path className="tr-barrier" d="M276 251 V70 M270 76 L276 70 L282 76 M270 244 L276 251 L282 244" />
      <path className="tr-barrier tr-catalysed" d="M238 251 V182 M232 188 L238 182 L244 188 M232 244 L238 251 L244 244" />
      <text x="301" y="89" {...source('uncatalysed')}>{label('uncatalysed')}</text>
      <text x="299" y="187" {...source('catalysed')}>{label('catalysed')}</text>
      <text x="77" y="285" {...source('reactants')}>{label('reactants')}</text>
      <text x="454" y="320" {...source('products')}>{label('products')}</text>
      <text x="97" y="126" {...source('ea')}>{label('ea')}</text>
    </svg>
    <figcaption>Qualitative · not to scale</figcaption>
  </figure>;
}

/** Native deterministic MathML; the producer supplies only an accepted equation
 * ref. The exact supported expression is checked before this renderer is used.
 */
const m = (tag: string, ...children: ReactNode[]) => createElement(tag, null, ...children);
export function Equation({ state, reference }: { state: CoreTeachingState; reference: SemanticReference }) {
  return <div className="tr-equation" data-semantic-id={reference.id} data-payload-kind="EQUATION">
    {createElement('math', { xmlns: 'http://www.w3.org/1998/Math/MathML', display: 'block', 'aria-label': textOf(state, reference) },
      m('mi', 'k'), m('mo', '='), m('mi', 'A'), m('msup', m('mi', 'e'), m('mrow', m('mo', '−'),
        m('mfrac', m('msub', m('mi', 'E'), m('mi', 'a')), m('mrow', m('mi', 'R'), m('mi', 'T'))))))}
  </div>;
}
