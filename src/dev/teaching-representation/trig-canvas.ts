import type { LearnerProjection } from '../../learner-projection/contracts.ts';
import type { LessonStep } from './lesson.ts';
import { textOf, unit, type Production } from './producer.ts';
import { visualId, type Visual, type canvasCatalog } from './canvas-model.ts';

/** Bounded authored development fixture placement, not a Math spatial policy.
 * Existing measurement, home storage, compositor, motion and camera execute it.
 */
export function trigCanvasCatalog(step: LessonStep, production: Production, projection: LearnerProjection): ReturnType<typeof canvasCatalog> {
  const title = step.refs.title, composing = projection.transition.framing === 'COMPARE';
  const roles = new Map(projection.attention.representations.map(r => [r.id, r.role]));
  const items: Visual[] = unit(step.state, title) ? [{ id: visualId(title), reference: title, title: true, kind: 'CORE',
    coreId: step.refs.trigCore.id, origin: 'Sine transformations', text: textOf(step.state, title), label: '', role: 'history',
    durable: true, visible: true, width: 1080, fixturePosition: { x: 0, y: 0 } }] : [];
  for (const payload of Object.values(production.registry)) {
    if (payload.kind === 'EQUATION' && payload.format === 'TRIG') {
      const row = payload.equation.id === step.refs.base.id ? 110 : payload.equation.id === step.refs.amplitude?.id ? 245 : 420;
      items.push({ id: visualId(payload.equation), reference: payload.equation, payload, kind: 'OBJECT', coreId: step.refs.trigCore.id,
        origin: 'Sine transformations', text: textOf(step.state, payload.equation), label: '', durable: true, visible: true,
        role: roles.get(payload.id) === 'dominant' ? 'primary' : roles.has(payload.id) ? 'context' : 'history',
        width: 460, presentationWidth: 240, fixturePosition: { x: 0, y: row } });
    } else if (payload.kind === 'PLOT' && payload.plotKind === 'FUNCTION_2D') {
      items.push({ id: `presentation:${payload.id}`, payload, kind: 'REPRESENTATION', coreId: step.refs.trigCore.id,
        origin: 'Sine transformations', text: '', label: '', durable: false, visible: true,
        role: roles.has(payload.id) ? 'context' : 'history', width: 560, fixturePosition: { x: 510, y: 105 } });
    }
  }
  const required = items.filter(i => !composing || i.role !== 'history').map(i => i.id);
  return { items, links: [], scene: { items, required, primary: items.filter(i => i.role === 'primary').map(i => i.id),
    framing: composing ? 'COMPARE' : 'HOME', preserve: false, currentCoreId: step.state.knowledge.currentCoreId, label: step.title, edges: [] } };
}
