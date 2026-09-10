import { useId } from "react";
import type { Point } from "../../canvas-spatial/geometry.ts";

export type HomeMapNode = { id: string; home: Point; position: Point; label: string };

/** Development diagnostic marks only: no teaching content, semantic identity or
 * second canonical render node is created by this overview.
 */
export default function HomeMap({ nodes }: { nodes: HomeMapNode[] }) {
  const marker = `home-map-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const moved = nodes.filter(node => [node.home.x, node.home.y, node.position.x, node.position.y].every(Number.isFinite)
    && (node.home.x !== node.position.x || node.home.y !== node.position.y));
  const points = moved.flatMap(node => [node.home, node.position]);
  const left = points.length ? Math.min(...points.map(point => point.x)) : 0;
  const top = points.length ? Math.min(...points.map(point => point.y)) : 0;
  const right = Math.max(left + 1, ...points.map(point => point.x));
  const bottom = Math.max(top + 1, ...points.map(point => point.y));
  const scale = Math.min(196 / (right - left), 86 / (bottom - top));
  const project = (point: Point) => ({
    x: 110 + (point.x - (left + right) / 2) * scale,
    y: 55 + (point.y - (top + bottom) / 2) * scale,
  });
  return <figure className="choreo-home-map">
    <figcaption>Home ○ → presentation ●</figcaption>
    {moved.length ? <svg viewBox="0 0 220 110" width="220" height="110" role="img" aria-label="Home positions and temporary presentation positions">
      <defs><marker id={marker} viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
        <path d="M0 0L6 3L0 6" fill="none" stroke="#a16936" strokeWidth="1" />
      </marker></defs>
      {moved.map(node => {
        const home = project(node.home), position = project(node.position);
        const description = `${node.label}: home (${node.home.x}, ${node.home.y}); presentation (${node.position.x}, ${node.position.y}).`;
        return <g key={node.id} role="img" aria-label={description}>
          <title>{description}</title>
          <line x1={home.x} y1={home.y} x2={position.x} y2={position.y} stroke="#a16936" strokeWidth="1.2" markerEnd={`url(#${marker})`} />
          <circle cx={home.x} cy={home.y} r="4" fill="#fffaf0" stroke="#a16936" strokeWidth="1.5" />
          <circle cx={position.x} cy={position.y} r="3.5" fill="#17634a" />
        </g>;
      })}
    </svg> : <p>No temporary displacement.</p>}
  </figure>;
}
