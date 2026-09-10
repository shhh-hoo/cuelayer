import { getSmoothStepPath, Position } from "@xyflow/react";

export type RelationBox = { id: string; x: number; y: number; width: number; height: number };
type HandleSide = "left" | "right";

const right = (box: RelationBox) => box.x + box.width;
const intersects = (a: RelationBox, b: RelationBox) => a.x < right(b) && right(a) > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;

/** Bounded presentation routing, using only the passed current rectangles.
 * This chooses the existing facing ports or outside corridor; it does not
 * place objects, alter homes, or infer a relation's semantic direction.
 */
export function routeRelation(source: RelationBox, target: RelationBox, obstacles: RelationBox[]): {
  path: string; sourceHandle: HandleSide; targetHandle: HandleSide;
} | undefined {
  const others = obstacles.filter(box => box.id !== source.id && box.id !== target.id);
  if (source.id === target.id || intersects(source, target)
    || others.some(box => intersects(source, box) || intersects(target, box))) return undefined;
  const leftToRight = right(source) <= target.x;
  const rightToLeft = right(target) <= source.x;
  const sourceHandle = rightToLeft ? "left" : "right";
  const targetHandle = leftToRight ? "left" : "right";
  const sourceX = sourceHandle === "left" ? source.x : right(source);
  const targetX = targetHandle === "left" ? target.x : right(target);
  const sourceY = source.y + source.height / 2;
  const targetY = target.y + target.height / 2;
  const spansText = (leftToRight || rightToLeft) && others.some(box =>
    box.x > Math.min(source.x, target.x) && box.x < Math.max(source.x, target.x));
  if (!spansText) {
    const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY,
      sourcePosition: sourceHandle === "left" ? Position.Left : Position.Right,
      targetPosition: targetHandle === "left" ? Position.Left : Position.Right,
      borderRadius: 14, offset: 14 });
    return { path, sourceHandle, targetHandle };
  }
  const boxes = [source, target, ...others];
  const corridorY = Math.min(...boxes.map(box => box.y)) - 24;
  const exitX = (box: RelationBox, side: HandleSide) => {
    const x = side === "left" ? box.x : right(box);
    const gaps = boxes.filter(other => other.id !== box.id)
      .map(other => side === "left" ? x - right(other) : other.x - x)
      .filter(gap => gap >= 0);
    // Stay in the available gap rather than entering the next text box.
    const offset = Math.min(16, gaps.length ? Math.min(...gaps) / 2 : 16);
    return x + (side === "left" ? -offset : offset);
  };
  const sourceExit = exitX(source, sourceHandle);
  const targetEntry = exitX(target, targetHandle);
  return {
    path: `M${sourceX},${sourceY} L${sourceExit},${sourceY} L${sourceExit},${corridorY} L${targetEntry},${corridorY} L${targetEntry},${targetY} L${targetX},${targetY}`,
    sourceHandle, targetHandle,
  };
}
