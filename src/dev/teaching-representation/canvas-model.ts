import { bounds, type Point } from '../../canvas-spatial/geometry.ts';
import type { LearnerProjection } from '../../learner-projection/contracts.ts';
import type { SemanticReference } from '../../lesson-stream/core/contracts.ts';
import { type TeachingItem, type TeachingScene, type HomeGeometry, temporaryPlacement } from '../m4b-choreography/model.ts';
import { solvePresentation } from '../m4b-choreography/solvers.ts';
import type { LessonStep } from './lesson.ts';
import { textOf, unit, type Production, type TeachingPresentationPayload } from './producer.ts';

export type Visual = TeachingItem & { reference?: SemanticReference; payload?: TeachingPresentationPayload; title?: boolean; origin: string;
  width?: number; presentationWidth?: number; fixturePosition?: Point };
export const visualId = (reference: SemanticReference) => `accepted:${reference.id}`;
export function canvasCatalog(step: LessonStep, production: Production, projection: LearnerProjection): { items: Visual[]; scene: TeachingScene; links: Extract<TeachingPresentationPayload, { kind: 'RELATION_CHAIN' }>['links'] } {
  const items = new Map<string, Visual>();
  const roles = new Map(projection.attention.representations.map(r => [r.id, r.role]));
  const selectedRefs = new Map<string, 'primary' | 'context'>();
  for (const [id, role] of roles) for (const ref of production.registry[id]?.semanticRefs ?? []) selectedRefs.set(ref.id, role === 'dominant' ? 'primary' : 'context');
  if (projection.transition.framing === 'WIDEN' || projection.transition.framing === 'COMPARE') {
    selectedRefs.clear();
    if (projection.attention.anchor) selectedRefs.set(projection.attention.anchor.id, 'primary');
    for (const ref of projection.attention.emphasis) selectedRefs.set(ref.id, 'primary');
    for (const ref of projection.attention.context) selectedRefs.set(ref.id, 'context');
  }
  const origin = (ref: SemanticReference) => ref.kind !== 'CORE' && ref.kind !== 'CUE' && ref.coreId === step.refs.arrheniusCore?.id ? 'Arrhenius' : 'Catalyst';
  const addObject = (ref: SemanticReference, payload?: TeachingPresentationPayload, title = false) => {
    if (!unit(step.state, ref)) return;
    const id = visualId(ref), old = items.get(id);
    const coreId = 'coreId' in ref ? ref.coreId : ref.id;
    items.set(id, { ...old, id, coreId, reference: ref, text: textOf(step.state, ref), kind: title ? 'CORE' : 'OBJECT',
      origin: origin(ref), role: selectedRefs.get(ref.id) ?? 'history', label: '', durable: true, visible: true, title,
      payload: payload?.kind === 'EQUATION' ? payload : old?.payload });
  };
  for (const key of ['catalyst', 'arrhenius']) if (step.refs[key]) addObject(step.refs[key], undefined, true);
  let links: Extract<TeachingPresentationPayload, { kind: 'RELATION_CHAIN' }>['links'] = [];
  for (const payload of Object.values(production.registry)) {
    if (payload.kind === 'PLOT') {
      const target = payload.semanticRefs[0];
      items.set(`presentation:${payload.id}`, { id: `presentation:${payload.id}`, coreId: 'coreId' in target ? target.coreId : undefined,
        text: '', kind: 'REPRESENTATION', role: roles.get(payload.id) === 'dominant' ? 'primary' : roles.has(payload.id) ? 'context' : 'history',
        origin: 'Catalyst', label: '', durable: false, visible: true, payload });
    } else {
      for (const ref of payload.semanticRefs) addObject(ref, payload);
      if (payload.kind === 'RELATION_CHAIN') links = [...links, ...payload.links];
    }
  }
  // Accepted nodes previously taught in the chain remain available after link
  // withdrawal. Only the invalidated connector disappears; no fact is deleted.
  for (const key of ['definition', 'pathway', 'lower', 'fraction', 'rate', 'consequence']) if (step.refs[key]) addObject(step.refs[key]);
  const list = [...items.values()];
  const composing = ['WIDEN', 'COMPARE'].includes(projection.transition.framing);
  const required = list.filter(item => composing ? item.role !== 'history' : item.coreId === step.state.knowledge.currentCoreId).map(item => item.id);
  links = [...new Map(links.map(link => [link.ref.id, link])).values()];
  return { items: list, links, scene: { items: list, primary: list.filter(i => i.role === 'primary').map(i => i.id), required,
    framing: composing ? projection.transition.framing : 'HOME', preserve: projection.projector === 'PRESERVE_VIEW',
    currentCoreId: step.state.knowledge.currentCoreId, label: step.title, edges: links.map(l => ({ id: l.ref.id, source: visualId(l.from), target: visualId(l.to), label: textOf(step.state, l.ref) })) } };
}

/** Small authored host placement for these presentation primitives. Rows reserve
 * the measured text height on first appearance. Existing homes never move. Plot
 * attachment lives in a separate discardable host map, not durable home truth.
 * Temporary WIDEN/COMPARE still runs PR #27's compositor and placement unchanged.
 */
export function establishHomes(previous: HomeGeometry, items: Visual[], sizes: HomeGeometry['sizes']): HomeGeometry {
  const homes = structuredClone(previous);
  for (const item of items.filter(i => i.durable)) {
    const core = item.coreId!;
    homes.coreOrigins[core] ??= item.fixturePosition ?? { x: item.origin === 'Catalyst' ? 0 : 1600, y: 0 };
    if (!homes.positions[item.id]) {
      const sameCore = items.filter(i => i.coreId === core && homes.positions[i.id]);
      const bottom = Math.max(0, ...sameCore.map(i => homes.positions[i.id].y + homes.sizes[i.id].height + (i.title ? 24 : 30)));
      homes.positions[item.id] = item.fixturePosition ?? { x: homes.coreOrigins[core].x, y: bottom };
    }
    homes.sizes[item.id] = sizes[item.id];
  }
  return homes;
}

export async function presentationPositions(scene: TeachingScene, homes: HomeGeometry, sizes: HomeGeometry['sizes'], width: number, height: number) {
  if (scene.framing !== 'WIDEN' && scene.framing !== 'COMPARE') return { positions: {} as Record<string, Point>, solveMs: 0 };
  const selected = scene.items.filter(item => scene.required.includes(item.id));
  const result = await solvePresentation('baseline', { nodes: selected.map(item => ({ id: item.id, ...sizes[item.id], home: homes.positions[item.id] ?? plotAttachment(homes, item as Visual), role: item.role === 'primary' ? 'primary' : 'context' })),
    edges: [], viewport: { width: width - 100, height: height - 80 }, gap: 48, orientation: 'horizontal' });
  return { positions: temporaryPlacement(result, selected, sizes, homes, scene), solveMs: result.elapsedMs };
}
export function cameraFor(scene: TeachingScene, positions: Record<string, Point>, sizes: HomeGeometry['sizes'], width: number, height: number) {
  const composing = scene.framing === 'WIDEN' || scene.framing === 'COMPARE';
  const area = bounds(scene.required.map(id => ({ ...positions[id], ...sizes[id] }))) ?? { x: 0, y: 0, width: 1, height: 1 };
  return { x: composing ? (width - area.width) / 2 - area.x : 52 - area.x,
    y: composing ? (height - area.height) / 2 - area.y : 24 - area.y, zoom: 1 };
}
export const plotAttachment = (homes: HomeGeometry, item: Visual): Point => item.fixturePosition ?? ({ x: (homes.coreOrigins[item.coreId!]?.x ?? 0) + 580, y: 175 });
