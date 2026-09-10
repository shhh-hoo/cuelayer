import type { LearnerProjection } from '../learner-projection/contracts.ts';
import { bounds, type Rect, type Size, type Viewport } from './geometry.ts';

export type PresentationGeometry = { boxes: Record<string, Rect>; temporary: Record<string, Rect>; camera: Viewport; fits: boolean };
/** Temporary composition contains only canonical selected IDs. Homes are input
 * only; no temporary coordinate is written back into Semantic Spaces. */
export function composePresentation(homes: Record<string, Rect>, selected: string[], projection: LearnerProjection, surface: Size): PresentationGeometry {
  const ids = [...new Set(selected)].filter(id => homes[id]);
  const temporary: Record<string, Rect> = {};
  if (projection.transition.framing !== 'FOCUS') {
    let x = 0;
    for (const id of ids) { temporary[id] = { ...homes[id], x, y: 0 }; x += homes[id].width + 32; }
  }
  const boxes = { ...homes, ...temporary };
  const area = bounds(ids.map(id => boxes[id])) ?? { x: 0, y: 0, width: 1, height: 1 };
  const fit = Math.min(1, (surface.width - 64) / area.width, (surface.height - 48) / area.height);
  const zoom = Math.max(0.65, fit);
  return { boxes, temporary, fits: fit >= 0.65, camera: {
    x: (surface.width - area.width * zoom) / 2 - area.x * zoom,
    y: (surface.height - area.height * zoom) / 2 - area.y * zoom, zoom,
  } };
}
