import { describe, expect, it } from "vitest";
import { routeRelation, type RelationBox } from "./relations";

const box = (id: string, x: number, y: number, width = 392, height = 188): RelationBox => ({ id, x, y, width, height });

// Independently sample the line/quadratic commands produced by SmoothStep.
// Endpoints may touch a rectangle boundary, but no sample may enter its text.
function sampledPoints(path: string): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  let cursor = { x: 0, y: 0 };
  for (const command of path.matchAll(/([MLQ])([^MLQ]*)/g)) {
    const values = command[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)!.map(Number);
    if (command[1] === "M") cursor = { x: values[0], y: values[1] };
    else {
      const start = cursor;
      const end = command[1] === "Q" ? { x: values[2], y: values[3] } : { x: values[0], y: values[1] };
      for (let i = 0; i <= 40; i += 1) {
        const t = i / 40;
        points.push(command[1] === "Q" ? {
          x: (1 - t) ** 2 * start.x + 2 * (1 - t) * t * values[0] + t ** 2 * end.x,
          y: (1 - t) ** 2 * start.y + 2 * (1 - t) * t * values[1] + t ** 2 * end.y,
        } : { x: start.x + t * (end.x - start.x), y: start.y + t * (end.y - start.y) });
      }
      cursor = end;
    }
  }
  return points;
}

function expectOutsideText(path: string, boxes: RelationBox[]) {
  const points = sampledPoints(path);
  expect(points.length).toBeGreaterThan(0);
  for (const rectangle of boxes) {
    expect(points.some(point => point.x > rectangle.x + .0001 && point.x < rectangle.x + rectangle.width - .0001
      && point.y > rectangle.y + .0001 && point.y < rectangle.y + rectangle.height - .0001), rectangle.id).toBe(false);
  }
}

describe("presentation relation routing", () => {
  it("uses current positions, and follows moved and translated endpoints", () => {
    const source = box("a", 0, 0, 100, 80), target = box("b", 132, 0, 100, 80);
    const first = routeRelation(source, target, [])!;
    expect(sampledPoints(first.path).at(0)).toEqual({ x: 100, y: 40 });
    expect(sampledPoints(first.path).at(-1)).toEqual({ x: 132, y: 40 });
    const moved = routeRelation({ ...source, x: 300, y: 50 }, target, [])!;
    expect(moved.sourceHandle).toBe("left");
    expect(moved.targetHandle).toBe("right");
    expect(sampledPoints(moved.path).at(0)).toEqual({ x: 300, y: 90 });
    expect(sampledPoints(moved.path).at(-1)).toEqual({ x: 232, y: 40 });
    const translated = routeRelation({ ...source, x: source.x + 500, y: source.y - 200 },
      { ...target, x: target.x + 500, y: target.y - 200 }, [])!;
    const firstPoints = sampledPoints(first.path), movedPoints = sampledPoints(translated.path);
    expect(movedPoints.length).toBe(firstPoints.length);
    for (let i = 0; i < firstPoints.length; i += 1) {
      expect(movedPoints[i].x).toBeCloseTo(firstPoints[i].x + 500);
      expect(movedPoints[i].y).toBeCloseTo(firstPoints[i].y - 200);
    }
  });

  it("keeps the normal measured desktop Math comparison connector outside text", () => {
    const nodes = [box("base", 0, 117, 392, 108), box("transformed", 424, 117), box("context", 848, 117, 392, 148)];
    const route = routeRelation(nodes[0], nodes[1], nodes)!;
    expect(route.sourceHandle).toBe("right");
    expect(route.targetHandle).toBe("left");
    expectOutsideText(route.path, nodes);
  });

  it("routes both accepted History branches outside all five measured comparison boxes", () => {
    const nodes = [box("proclamation", 0, 0), box("a", 424, 0), box("b", 848, 0),
      box("source-a", 0, 220, 392, 148), box("source-b", 424, 220, 392, 148)];
    for (const target of [nodes[1], nodes[2]]) {
      const route = routeRelation(nodes[0], target, nodes)!;
      expect(route).toBeDefined();
      expectOutsideText(route.path, nodes);
    }
    const longBranch = routeRelation(nodes[0], nodes[2], nodes)!;
    expect(sampledPoints(longBranch.path).some(point => point.y === -24)).toBe(true);
  });

  it("caps an outside-corridor exit at a narrow gap midpoint", () => {
    const nodes = [box("a", 0, 0, 100, 80), box("between", 110, 0, 100, 80), box("b", 220, 0, 100, 80)];
    const route = routeRelation(nodes[0], nodes[2], nodes)!;
    expect(route.path).toContain("L105,40 L105,-24");
    expect(route.path).toContain("L215,-24 L215,40");
    expectOutsideText(route.path, nodes);
  });

  it("uses the outside right corridor for the ordinary vertical home relation", () => {
    const nodes = [box("path", 0, 0, 780, 80), box("barrier", 0, 128, 780, 80)];
    const route = routeRelation(nodes[0], nodes[1], nodes)!;
    expect(route.sourceHandle).toBe("right");
    expect(route.targetHandle).toBe("right");
    expectOutsideText(route.path, nodes);
  });

  it("suppresses routes through overlapping in-flight boxes without mutating inputs", () => {
    const source = Object.freeze(box("a", 0, 0, 100, 80));
    const target = Object.freeze(box("b", 50, 0, 100, 80));
    const obstacles = [source, target];
    const snapshot = JSON.stringify(obstacles);
    expect(routeRelation(source, target, obstacles)).toBeUndefined();
    routeRelation(source, Object.freeze({ ...target, x: 132 }), obstacles);
    expect(JSON.stringify(obstacles)).toBe(snapshot);
  });
});
