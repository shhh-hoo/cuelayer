import {
  proposalSchema,
  reduceOperations,
  version,
  type Accepted,
  type Expression,
  type Meaning,
  type Proposal,
  type Replay,
  type Task,
} from "./contract";

export class Rejection extends Error {}
const requireThat = (condition: unknown, reason: string): void => {
  if (!condition) throw new Rejection(reason);
};
function validateMeaning(m: Meaning) {
  if (m.kind !== "quantity") return;
  const walk = (e: Expression): void => {
    if (typeof e === "number") return;
    if (typeof e === "string") {
      requireThat(Boolean(m.symbols[e]), "missing-symbol-binding");
      return;
    }
    const [op, ...args] = e;
    requireThat(args.length === (op === "Sin" ? 1 : 2), "missing-operand");
    args.forEach(walk);
  };
  walk(m.expression);
  requireThat(
    Array.isArray(m.expression) && m.expression[0] === "Equal",
    "missing-quantitative-relation",
  );
  if (m.domain)
    requireThat(
      m.domain[0] < m.domain[1] && m.independent && m.symbols[m.independent],
      "invalid-domain",
    );
}
/** Host-captured context and capabilities are immutable; proposals cannot supply their own read set. */
export function validate(
  replay: Replay,
  task: Task,
  raw: unknown,
): { proposal: Proposal; accepted: Accepted } {
  const parsed = proposalSchema.safeParse(raw);
  requireThat(parsed.success, "incomplete-or-malformed-proposal");
  const p = parsed.data!;
  requireThat(!replay.ended, "session-ended");
  requireThat(p.taskId === task.id, "task-binding");
  for (const [key, v] of Object.entries(task.dependencies))
    requireThat(version(replay.state, key) === v, `stale-dependency:${key}`);
  const readableEvidence = [...task.evidence, ...(task.contextEvidence ?? [])];
  const evidence = new Map(readableEvidence.map((e) => [e.id, e]));
  for (const e of readableEvidence)
    requireThat(
      replay.evidence.some(
        (current) => current.id === e.id && current.text === e.text,
      ),
      "uncommitted-evidence",
    );
  for (const unit of Object.values(task.state.units))
    for (const reference of unit.basis) {
      const source = replay.evidence.find((e) => e.id === reference.evidenceId);
      if (source) evidence.set(source.id, source);
    }
  const basis = (refs: { evidenceId: string; quote: string }[]) =>
    refs.forEach((r) =>
      requireThat(
        evidence.get(r.evidenceId)?.text.includes(r.quote),
        "ungrounded-quote",
      ),
    );
  const created = new Set<string>();
  const proposedUnits = new Set(
    p.operations.filter((op) => op.type === "put").map((op) => op.id),
  );
  for (const op of p.operations) {
    basis(op.basis);
    if (op.type === "core") {
      requireThat(task.lane === "Live", "stage-cannot-create-core");
      created.add(op.id);
    }
    if (op.type === "put") {
      requireThat(
        created.has(op.coreId) || task.allowedCores.includes(op.coreId),
        "write-scope",
      );
      const old = replay.state.units[op.id];
      if (old)
        requireThat(
          Object.hasOwn(task.dependencies, `unit/${op.id}`),
          "uncaptured-write",
        );
      validateMeaning(op.meaning);
      const refs = [
        ...op.requires,
        ...(op.meaning.kind === "relation"
          ? op.meaning.targets
          : op.meaning.kind === "annotation"
            ? [op.meaning.target]
            : []),
      ];
      for (const id of refs)
        requireThat(
          proposedUnits.has(id) ||
            (task.state.units[id] &&
              Object.hasOwn(task.dependencies, `unit/${id}`)),
          "uncaptured-semantic-dependency",
        );
    }
    if (op.type === "invalidate")
      requireThat(
        Object.hasOwn(task.dependencies, `unit/${op.id}`),
        "uncaptured-write",
      );
    if (op.type === "mainline")
      requireThat(
        Object.hasOwn(task.dependencies, "mainline"),
        "uncaptured-mainline",
      );
    if (op.type === "cue") {
      requireThat(Object.hasOwn(task.dependencies, "cue"), "uncaptured-cue");
      if (op.value) basis(op.value.basis);
    }
  }
  const next = reduceOperations(replay.state, p.operations);
  for (const unit of Object.values(next.units).filter((u) => u.valid)) {
    const refs = [
      ...unit.requires,
      ...(unit.meaning.kind === "relation"
        ? unit.meaning.targets
        : unit.meaning.kind === "annotation"
          ? [unit.meaning.target]
          : []),
    ];
    for (const id of refs)
      requireThat(next.units[id]?.valid, "invalid-semantic-dependency");
  }
  for (const id of next.cue?.targets ?? [])
    requireThat(next.units[id]?.valid, "invalid-cue-target");
  requireThat(
    new Set(p.dispositions.map((d) => d.evidenceId)).size ===
      p.dispositions.length,
    "duplicate-disposition",
  );
  if (task.lane === "Live") {
    requireThat(
      (next.revision !== replay.state.revision) ===
        p.dispositions.some((d) => d.status === "established"),
      "change-disposition-mismatch",
    );
    const pending = replay.evidence
      .filter((e) => !replay.consumed[e.id])
      .slice(0, task.evidence.length);
    requireThat(
      JSON.stringify(pending.map((e) => e.id)) ===
        JSON.stringify(task.evidence.map((e) => e.id)),
      "noncontiguous-consumption",
    );
    requireThat(
      JSON.stringify(p.dispositions.map((d) => d.evidenceId)) ===
        JSON.stringify(task.evidence.map((e) => e.id)),
      "incomplete-consumption",
    );
  } else requireThat(p.dispositions.length === 0, "stage-reconsumption");
  for (const u of p.unresolved) {
    requireThat(
      evidence.get(u.evidenceId)?.text.includes(u.phrase),
      "ungrounded-unresolved",
    );
    requireThat(
      p.dispositions.some(
        (d) => d.evidenceId === u.evidenceId && d.status === "unresolved",
      ),
      "missing-unresolved-disposition",
    );
    requireThat(
      !u.coreId || Boolean(next.cores[u.coreId]),
      "unknown-obligation-core",
    );
  }
  for (const d of p.dispositions)
    if (d.status === "unresolved")
      requireThat(
        p.unresolved.some((u) => u.evidenceId === d.evidenceId),
        "lost-unresolved-meaning",
      );
  for (const id of p.resolve)
    requireThat(
      task.obligations.some((o) => o.id === id) && replay.unresolved[id],
      "unbound-resolution",
    );
  for (const id of p.attention?.targets ?? [])
    requireThat(next.units[id]?.valid, "invalid-attention");
  return {
    proposal: p,
    accepted: {
      taskId: task.id,
      lane: task.lane,
      dependencies: task.dependencies,
      operations: p.operations,
      dispositions: p.dispositions,
      unresolved: p.unresolved.map((u) => ({
        id: `obligation:${u.evidenceId}`,
        evidenceIds: [u.evidenceId],
        phrase: u.phrase,
        coreId: u.coreId,
        createdAt: task.createdAt,
      })),
      resolved: p.resolve,
      reviewed:
        task.lane === "Stage"
          ? task.evidence.filter((e) => replay.consumed[e.id]).map((e) => e.id)
          : [],
    },
  };
}
