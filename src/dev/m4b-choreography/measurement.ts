import type { TeachingItem, TeachingScene, Measurements, HomeGeometry, TeachingFrame } from "./model.ts";
import { acceptHomes, temporaryPlacement } from "./model.ts";
import { solvePresentation, type SolverId } from "./solvers.ts";
import { bounds, type Size } from "../../canvas-spatial/geometry.ts";

export const GAP = 32;
export const teachingFont = (item: TeachingItem, compact: boolean) => item.kind === "CORE" ? compact ? 42 : 60 : compact ? 28 : 32;
export const minimumFont = (item: TeachingItem, compact: boolean) => item.role === "primary" ? compact ? 28 : 32 : compact ? 26 : 28;
export const readableRegion = (surface: Size) => ({ width: Math.max(1, surface.width - 40), height: Math.max(1, surface.height - 72) });

/** Actual DOM measurement, using the rendered article's typography and content.
 * Measurement probes are immediately removed, aria-hidden, and never carry a
 * canonical render ID. They are not Canvas nodes or alternate semantic objects.
 */
export function measureItems(items: TeachingItem[], width: number, compact: boolean, presentation = false): Measurements {
  const host = document.createElement("div");
  host.className = "choreo-measure";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none;";
  const elements = items.map(item => {
    const article = document.createElement("article");
    article.className = "choreo-node";
    article.dataset.role = item.role;
    article.dataset.kind = item.kind;
    article.style.width = `${width}px`;
    article.style.setProperty("--teaching-font", `${teachingFont(item, compact)}px`);
    if (presentation && item.coreId && item.kind !== "CORE") {
      const label = document.createElement("div"); label.className = "choreo-origin";
      label.textContent = item.coreId.replaceAll("-", " "); article.append(label);
    }
    const text = document.createElement(item.kind === "CORE" ? "h2" : "p");
    text.className = "choreo-copy"; text.textContent = item.text; article.append(text);
    host.append(article); return { item, article };
  });
  document.body.append(host);
  try {
    return Object.fromEntries(elements.map(({ item, article }) => {
      const rect = article.getBoundingClientRect();
      if (!rect.width || !rect.height) throw new Error(`DOM measurement unavailable: ${item.id}`);
      return [item.id, { width: Math.ceil(rect.width), height: Math.ceil(rect.height) }];
    }));
  } finally { host.remove(); }
}

export async function prepareTeachingFrame(scene: TeachingScene, oldHomes: HomeGeometry, surface: Size, solver: SolverId,
  workMode: "adjacent" | "attached", onHomes?: (homes: HomeGeometry) => void): Promise<{ homes: HomeGeometry; frame: TeachingFrame; measurementMs: number }> {
  const started = performance.now();
  const compact = surface.width < 600;
  const region = readableRegion(surface);
  const homeSizes = measureItems(scene.items, compact ? region.width : Math.min(780, region.width), compact);
  const homes = acceptHomes(oldHomes, scene, homeSizes);
  onHomes?.(homes);
  const composing = scene.framing === "COMPARE" || scene.framing === "WIDEN";
  const selected = scene.items.filter(item => scene.required.includes(item.id));
  const work = scene.items.filter(item => item.kind === "WORK" && item.visible);
  const attached = workMode === "attached" && work.length > 0;
  const solving = composing || attached;
  const targets = [...selected, ...(attached ? work.filter(item => !scene.required.includes(item.id)) : [])];
  const columns = compact ? 1 : Math.min(3, Math.max(1, targets.length));
  const width = compact ? region.width : Math.min(500, (region.width - (columns - 1) * GAP) / columns);
  const measured = solving ? measureItems(targets, width, compact, true) : {};
  const sizes = { ...homeSizes, ...measured };
  const measurementMs = performance.now() - started;
  let positions: TeachingFrame["positions"] = {};
  let solveMs = 0;
  const notes: string[] = [];
  if (solving) {
    const ids = new Set(targets.map(item => item.id));
    const result = await solvePresentation(solver, { nodes: targets.map(item => ({ id: item.id, ...sizes[item.id]!,
      home: homes.positions[item.id] ?? homes.coreOrigins[item.coreId ?? ""] ?? { x: 0, y: 0 }, role: item.role === "primary" ? "primary" : "context" })),
      edges: scene.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)), viewport: region, gap: GAP,
      orientation: compact ? "vertical" : "horizontal" });
    positions = temporaryPlacement(result, targets, sizes, homes, scene);
    solveMs = result.elapsedMs; notes.push(...result.notes);
  }
  // Work/representation/Cue never get a durable home. Their fallback attachment
  // is an explicit prototype option, not new semantic geography. Under PRESERVE
  // this candidate remains latest-only until an allowed follow/reframe.
  const occupied = scene.items.filter(item => item.visible && (homes.positions[item.id] || positions[item.id]))
    .map(item => ({ ...(positions[item.id] ?? homes.positions[item.id])!, ...sizes[item.id]! }));
  const local = bounds(selected.map(item => ({ ...(positions[item.id] ?? homes.positions[item.id] ?? { x: 0, y: 0 }), ...sizes[item.id]! })))
    ?? bounds(occupied) ?? { x: 0, y: 0, width: 0, height: 0 };
  let nextY = local.y + local.height + GAP;
  for (const item of scene.items.filter(item => !item.durable && item.visible && !positions[item.id])) {
    positions[item.id] = { x: local.x, y: nextY };
    nextY += sizes[item.id]!.height + GAP;
  }
  const framedScene = attached ? { ...scene, required: [...new Set([...scene.required, ...work.map(item => item.id)])] } : scene;
  if (work.length) notes.push(attached ? "Work participates only in this transient selected composition." : "Work uses a transient adjacent attachment; it does not force automatic primary camera fit.");
  return { homes, frame: { scene: framedScene, positions, sizes, solveMs, notes, compact }, measurementMs };
}
