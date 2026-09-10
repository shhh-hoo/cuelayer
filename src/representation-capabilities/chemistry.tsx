import { z } from 'zod';
import { defineCapability } from '../teaching-representation/capability.ts';
import { textOf, unit } from '../teaching-representation/grounding.ts';
import { objectRef, relationRef } from './accepted.tsx';

const labels = z.object({ reactants: objectRef, products: objectRef, uncatalysed: objectRef, catalysed: objectRef,
  progress: objectRef, energy: objectRef, ea: objectRef, endpoints: objectRef, exothermic: objectRef }).strict();
const meanings = { reactants: 'Reactants', products: 'Products', uncatalysed: 'Uncatalysed pathway', catalysed: 'Catalysed pathway',
  progress: 'Reaction progress', energy: 'Potential energy', ea: 'Activation energy, Eₐ',
  endpoints: 'Both pathways have the same reactant and product energies.',
  exothermic: 'In this example, products have lower potential energy than reactants.' };
export const energyProfileCapability = defineCapability({
  capabilityId: 'chemistry.energy-profile', representationKind: 'PLOT', preferredWidth: 530,
  schema: z.object({ labels, barrier: relationRef }).strict(),
  validate(data, state) {
    for (const key of Object.keys(meanings) as (keyof typeof meanings)[]) {
      if (textOf(state, data.labels[key]) !== meanings[key]) throw new Error(`energy-profile-meaning:${key}`);
    }
    const relation = unit(state, data.barrier)?.value;
    if (!relation || !('fromObjectId' in relation) || !('toObjectId' in relation) || relation.text !== 'The catalysed pathway has a lower activation-energy barrier than the uncatalysed pathway.'
      || relation.fromObjectId !== data.labels.catalysed.id || relation.toObjectId !== data.labels.uncatalysed.id
      || data.barrier.coreId !== data.labels.catalysed.coreId || data.barrier.coreId !== data.labels.uncatalysed.coreId) throw new Error('energy-profile-barrier');
    return { data, references: [...Object.values(data.labels), data.barrier] };
  },
  render(data, { state }) {
    const label = (key: keyof typeof meanings) => textOf(state, data.labels[key]);
    const source = (key: keyof typeof meanings) => ({ 'data-semantic-id': data.labels[key].id });
    return <figure className="energy-profile" aria-label="Qualitative energy profile, not to scale">
      <svg viewBox="0 0 560 360" role="img" aria-label="Both pathways share endpoints; the catalysed barrier is lower.">
        <path className="plot-axis" d="M58 25 V305 H535" />
        <text x="14" y="195" transform="rotate(-90 14 195)" {...source('energy')}>{label('energy')}</text>
        <text x="276" y="347" {...source('progress')}>{label('progress')}</text>
        <path className="curve curve-0" d="M70 254 C140 254 158 66 266 66 C375 66 398 287 505 287" />
        <path className="curve curve-1" d="M70 254 C140 254 170 178 266 178 C367 178 411 287 505 287" />
        <path className="plot-guide" d="M70 254 H280" />
        <path className="plot-axis" d="M276 251 V70 M270 76 L276 70 L282 76 M270 244 L276 251 L282 244" />
        <path className="plot-axis" d="M238 251 V182 M232 188 L238 182 L244 188 M232 244 L238 251 L244 244" />
        <text x="301" y="89" {...source('uncatalysed')}>{label('uncatalysed')}</text>
        <text x="299" y="187" {...source('catalysed')}>{label('catalysed')}</text>
        <text x="77" y="285" {...source('reactants')}>{label('reactants')}</text>
        <text x="454" y="320" {...source('products')}>{label('products')}</text>
        <text x="97" y="126" {...source('ea')}>{label('ea')}</text>
      </svg><figcaption>Qualitative · not to scale</figcaption>
    </figure>;
  },
});
export const arrheniusCapability = defineCapability({
  capabilityId: 'chemistry.arrhenius', representationKind: 'MATH', preferredWidth: 440,
  schema: z.object({ equation: objectRef }).strict(),
  validate(data, state) {
    if (textOf(state, data.equation) !== 'k = A e^(−Eₐ/RT)') throw new Error('arrhenius-meaning');
    return { data, references: [data.equation] };
  },
  render: (data, { state }) => <p className="representation-equation" data-semantic-id={data.equation.id} aria-label={textOf(state, data.equation)}>k = A e<sup>−Eₐ/RT</sup></p>,
});
