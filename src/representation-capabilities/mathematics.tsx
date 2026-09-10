import { z } from 'zod';
import type { AcceptedTeachingState } from '../teaching-representation/contracts.ts';
import { defineCapability, type ValidationPhase } from '../teaching-representation/capability.ts';
import { textOf, unit } from '../teaching-representation/grounding.ts';
import { objectRef, relationRef } from './accepted.tsx';
import { sampleSine, sineSchema } from './sine.ts';

export const sineFormSchema = z.object({ equation: objectRef, expression: sineSchema, label: objectRef, parameter: objectRef,
  valueRelation: relationRef, family: objectRef.optional(), rule: objectRef.optional(), ruleRelation: relationRef.optional(), comparison: relationRef.optional(),
}).strict();
export type SineForm = z.infer<typeof sineFormSchema>;
const references = (f: SineForm) => [f.equation, f.label, f.parameter, f.valueRelation, ...[f.family, f.rule, f.ruleRelation, f.comparison].filter(r => r !== undefined)];
const validFormRefs = (f: SineForm, state: AcceptedTeachingState) => references(f).every(r => unit(state, r));
function validateForm(f: SineForm, state: AcceptedTeachingState, base?: SineForm) {
  const variant = f.expression.amplitude === 2 ? 'amplitude' : f.expression.verticalShift === 1 ? 'shift' : 'base';
  const expected = {
    base: ['y = sin x', 'Base · a = 1', 'a = 1', 'The base sine function has a = 1.'],
    amplitude: ['y = 2 sin x', 'Amplitude · a = 2', 'a = 2', 'For a = 2, y = a sin x is y = 2 sin x.', 'y = a sin x', 'Amplitude = |a|', 'In y = a sin x, |a| controls amplitude.', 'At each x, y = 2 sin x has twice the y value of y = sin x.'],
    shift: ['y = sin x + 1', 'Vertical shift · c = 1', 'c = 1', 'For c = 1, y = sin x + c is y = sin x + 1.', 'y = sin x + c', 'Vertical shift = c', 'In y = sin x + c, c is the vertical shift.', 'At each x, y = sin x + 1 is one unit above y = sin x.'],
  }[variant];
  const relation = (ref: SineForm['valueRelation'], from: SineForm['equation'], to: SineForm['equation'], text: string) => {
    const value = unit(state, ref)?.value;
    if (!value || !('fromObjectId' in value) || !('toObjectId' in value) || value.text !== text || value.fromObjectId !== from.id || value.toObjectId !== to.id
      || ref.coreId !== from.coreId || ref.coreId !== to.coreId) throw new Error('sine-relationship-meaning');
  };
  if ([f.equation, f.label, f.parameter].some((ref, i) => textOf(state, ref) !== expected[i])) throw new Error('sine-object-meaning');
  relation(f.valueRelation, f.equation, f.parameter, expected[3]);
  if (variant !== 'base') {
    if (!f.family || !f.rule || !f.ruleRelation || textOf(state, f.family) !== expected[4] || textOf(state, f.rule) !== expected[5]) throw new Error('sine-rule-meaning');
    relation(f.ruleRelation, f.family, f.rule, expected[6]);
    if (base) {
      if (!f.comparison) throw new Error('sine-comparison-required');
      relation(f.comparison, base.equation, f.equation, expected[7]);
    } else if (f.comparison) throw new Error('unexpected-equation-comparison');
  } else if (f.family || f.rule || f.ruleRelation || f.comparison) throw new Error('unexpected-base-dependency');
}
export const sineEquationCapability = defineCapability({
  capabilityId: 'math.sine-equation', representationKind: 'MATH', preferredWidth: 330,
  schema: z.object({ form: sineFormSchema }).strict(),
  validate(data, state) { validateForm(data.form, state); return { data, references: references(data.form) }; },
  render: ({ form }, { state }) => <section className="sine-equation">
    <div className="equation-label" data-semantic-id={form.label.id}>{textOf(state, form.label)}</div>
    <p className="representation-equation" data-semantic-id={form.equation.id}>{textOf(state, form.equation)}</p>
    {form.family && <div className="equation-rule" data-semantic-id={form.family.id}>{textOf(state, form.family)}
      {form.rule && <div data-semantic-id={form.rule.id}>{textOf(state, form.rule)}</div>}</div>}
  </section>,
});
export const functionPlotCapability = defineCapability({
  capabilityId: 'math.function-plot', representationKind: 'PLOT', preferredWidth: 530,
  schema: z.object({ domain: objectRef, xAxis: objectRef, yAxis: objectRef, forms: z.array(sineFormSchema).min(1).max(3) }).strict(),
  validate(raw, state, phase: ValidationPhase) {
    if ([raw.domain, raw.xAxis, raw.yAxis].some((ref, i) => textOf(state, ref) !== ['0 ≤ x ≤ 2π', 'x (radians)', 'y'][i])) throw new Error('plot-domain-meaning');
    const forms = phase === 'reuse' ? raw.forms.filter(f => validFormRefs(f, state)) : raw.forms;
    if (!forms.length || forms[0].expression.amplitude !== 1 || forms[0].expression.verticalShift !== 0) throw new Error('plot-base-required');
    if (new Set(forms.map(f => f.equation.id)).size !== forms.length) throw new Error('duplicate-curve');
    forms.forEach((f, i) => validateForm(f, state, i ? forms[0] : undefined));
    return { data: { ...raw, forms }, references: [raw.domain, raw.xAxis, raw.yAxis, ...forms.flatMap(references)] };
  },
  render(data, { state }) {
    const x = (v: number) => 54 + v / (2 * Math.PI) * 468, y = (v: number) => 192 - v * 67;
    const color = (f: SineForm) => f.expression.amplitude === 2 ? 1 : f.expression.verticalShift === 1 ? 2 : 0;
    return <figure className="function-plot">
      <svg viewBox="0 0 560 405" role="img" aria-label={data.forms.map(f => textOf(state, f.equation)).join('; ')}>
        {[-2, -1, 0, 1, 2].map(t => <g key={t}><path className="plot-grid" d={`M54 ${y(t)} H522`} /><text x="40" y={y(t) + 7} textAnchor="end">{t}</text></g>)}
        {[0, Math.PI, 2 * Math.PI].map((t, i) => <g key={i}><path className="plot-grid" d={`M${x(t)} 48 V336`} /><text x={x(t)} y="363" textAnchor="middle">{['0', 'π', '2π'][i]}</text></g>)}
        <path className="plot-axis" d="M54 40 V336 M54 192 H531" />
        <text x="54" y="27" data-semantic-id={data.yAxis.id}>{textOf(state, data.yAxis)}</text>
        <text x="295" y="400" textAnchor="middle" data-semantic-id={data.xAxis.id}>{textOf(state, data.xAxis)}</text>
        {data.forms.map(f => <path key={f.equation.id} className={`curve curve-${color(f)}`} data-curve-ref={f.equation.id}
          d={sampleSine(f.expression).map((point, i) => `${i ? 'L' : 'M'}${x(point.x).toFixed(3)},${y(point.y).toFixed(3)}`).join(' ')} />)}
      </svg><figcaption>{data.forms.map(f => <span key={f.equation.id} className={`legend-${color(f)}`} data-semantic-id={f.equation.id}>{textOf(state, f.equation)}</span>)}</figcaption>
    </figure>;
  },
});
