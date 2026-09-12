import { isCurrent } from "./contract";
import type { ProjectionIntent, TeachingState, Unit } from "./contract";
export type Candidate = {
  id: string;
  unitId: string;
  version: number;
  form: "text" | "equation" | "reaction" | "relation" | "annotation" | "plot";
  requiredIds: string[];
};
export type Frame = {
  mode: "FOCUS" | "COMPARE" | "WIDEN";
  targets: string[];
  selected: Candidate[];
  cueVisible: boolean;
  degraded: string | null;
};
export function neighborhood(
  state: TeachingState,
  intent: ProjectionIntent | null,
): string[] {
  if (intent && intent.expiresAt <= performance.now()) intent = null;
  const roots =
    intent?.targets.filter(
      (id) =>
        isCurrent(state, id) && state.units[id].coreId === state.currentCoreId,
    ) ?? [];
  const ids = roots.length
    ? roots
    : [
        ...(state.cores[state.currentCoreId ?? ""]?.unitIds ??
          Object.keys(state.units)),
      ]
        .reverse()
        .sort(
          (a, b) =>
            (state.units[b].changedAt ?? 0) - (state.units[a].changedAt ?? 0),
        )
        .filter((id) => isCurrent(state, id))
        .slice(0, 1);
  const closure = new Set<string>();
  const visit = (id: string) => {
    if (closure.has(id) || !isCurrent(state, id)) return;
    closure.add(id);
    state.units[id].requires.forEach(visit);
  };
  ids.forEach(visit);
  return [...closure];
}
export function candidates(unit: Unit): Candidate[] {
  const base = {
    id: `artifact:${unit.id}`,
    unitId: unit.id,
    version: unit.version,
    requiredIds: unit.requires,
  };
  switch (unit.meaning.kind) {
    case "quantity":
      return [
        { ...base, form: "equation" },
        ...(unit.meaning.domain ? [{ ...base, form: "plot" as const }] : []),
      ];
    case "statement":
      return [{ ...base, form: "text" }];
    default:
      return [{ ...base, form: unit.meaning.kind }];
  }
}
export function decide(
  state: TeachingState,
  intent: ProjectionIntent | null,
): Frame {
  if (intent && intent.expiresAt <= performance.now()) intent = null;
  const ids = neighborhood(state, intent),
    available = ids.flatMap((id) => candidates(state.units[id]));
  const selected = ids.map((id) =>
    available.filter((c) => c.unitId === id).at(-1)!,
  );
  // Scope is deliberately bounded by an explicit readable envelope, never silently clipped.
  return {
    mode: intent?.mode ?? "FOCUS",
    targets: ids,
    selected,
    cueVisible: Boolean(state.cue?.targets.some((id) => ids.includes(id))),
    degraded:
      selected.length > 3
        ? "This teaching neighborhood needs a staged representation."
        : null,
  };
}
export type Home = { x: number; y: number; space: string };
/** Geography is projection policy: related units append into a shared neighborhood; revisions retain homes. */
export class Geography {
  homes = new Map<string, Home>();
  spaces = new Map<string, string[]>();
  reconcile(state: TeachingState) {
    for (const unit of Object.values(state.units)) {
      if (this.homes.has(unit.id)) continue;
      const anchor = unit.requires
        .map((id) => this.homes.get(id))
        .find(Boolean);
      const space = anchor?.space ?? unit.coreId;
      let members = this.spaces.get(space);
      if (!members) {
        members = [];
        this.spaces.set(space, members);
      }
      const spaceIndex = [...this.spaces.keys()].indexOf(space),
        index = members.length;
      // Grow downward inside a fixed-width lane; unrelated spaces occupy disjoint lanes.
      this.homes.set(unit.id, {
        x: spaceIndex * 760 + (index % 2) * 350,
        y: Math.floor(index / 2) * 420,
        space,
      });
      members.push(unit.id);
    }
  }
}
