import { Session, type Interpreter } from "../src/session";
import { EventStore } from "../src/adapters/storage";
import { type Task, type Meaning } from "../src/contract";
import { position, readable, type SourceCursor } from "../src/source";
import {
  projectMeaning,
  type LiveDecision,
  type WireOperation,
} from "../src/live-wire";
import {
  fixtureBasis,
  authoredPut,
  authoredRevisions,
} from "../src/fixture-author";
export {
  fixtureBasis,
  authoredPut,
  authoredRange,
} from "../src/fixture-author";
export type ApplyDecision = Omit<LiveDecision, "groups"> & {
  groups: Extract<LiveDecision["groups"][number], { outcome: "APPLY" }>[];
};
export const fast = {
  coalesceMs: 2,
  maxWaitMs: 8,
  deadlineMs: 2000,
  sourceChars: 2400,
  maxRequestBytes: 28000,
};
export const waitDecision = (task?: Task): LiveDecision => ({
  scope: task?.capture?.namespace ?? "test1",
  groups: [],
  suffixStatus: "WAIT_MORE_INPUT",
  contextRequest: null,
  reviewRequests: [],
  attentionCandidate: null,
});
export function fullGroup<O extends "NO_CHANGE" | "CARRY" = "NO_CHANGE">(
  task: Task,
  outcome: O = "NO_CHANGE" as O,
): Omit<LiveDecision, "groups"> & {
  groups: Extract<LiveDecision["groups"][number], { outcome: O }>[];
} {
  const throughBoundary = task.capture!.request.source.end;
  return {
    ...waitDecision(task),
    suffixStatus: "NONE",
    groups: [
      outcome === "CARRY"
        ? {
            outcome,
            throughBoundary,
            kind: "INCOMPLETE_PROPOSITION",
            core: null,
          }
        : { outcome, throughBoundary },
    ],
  } as Omit<LiveDecision, "groups"> & {
    groups: Extract<LiveDecision["groups"][number], { outcome: O }>[];
  };
}
export async function openSession(
  interpreter: Interpreter = async (t) => waitDecision(t),
) {
  return Session.open(
    crypto.randomUUID(),
    interpreter,
    new EventStore(`frontier-${crypto.randomUUID()}`),
    { ...fast },
  );
}
export async function admit(s: Session, text: string) {
  const i = s.replay.evidence.length;
  return s.commitEvidence({
    id: `e${i}`,
    run: "r",
    source: String(i),
    text,
    start: i,
    end: i + 1,
    receivedAt: performance.now(),
    audioObservedAt: null,
    stability: "COMMITTED",
  });
}
export const currentQuote = (s: Session, t: Task) =>
  readable(s.replay.evidence, t.capture!.range);
export function establish(
  task: Task,
  quote: string,
  meaning: Meaning = { kind: "statement", text: quote },
): ApplyDecision {
  const c = task.capture!,
    request = c.request,
    basis = fixtureBasis(task, quote, request.source.source);
  const core =
    request.currentCore ?? request.cores[0]?.id ?? request.newCores[0];
  const id = request.units[0]?.id ?? request.newUnits[0];
  const operations: WireOperation[] = [];
  if (!request.cores.length)
    operations.push(
      { type: "core", id: core, label: "Teaching", basis },
      { type: "mainline", coreId: core, basis },
    );
  const previous = task.state.units[c.units[id]];
  if (previous) {
    const revisions = authoredRevisions(
      id,
      previous.meaning,
      meaning,
      (x) => Object.keys(c.units).find((k) => c.units[k] === x)!,
      basis,
    );
    operations.push(
      ...(revisions.length
        ? revisions
        : [{ type: "revalidate" as const, id, basis }]),
    );
  } else
    operations.push(
      authoredPut({
        type: "put",
        id,
        coreId: core,
        meaning: projectMeaning(meaning, (a) =>
          Object.keys(c.units).find((k) => c.units[k] === a)!,
        ),
        dependencies: [],
        basis,
      }),
    );
  return {
    ...fullGroup(task),
    groups: [
      {
        ...fullGroup(task).groups[0],
        outcome: "APPLY",
        operations,
        resolutions: [],
      },
    ],
    attentionCandidate: { targets: [id], mode: "FOCUS" },
  };
}
export function boundary(s: Session, t: Task, cursor: SourceCursor) {
  return Object.keys(t.capture!.boundaries).find(
    (a) =>
      position(s.replay.evidence, t.capture!.boundaries[a]) ===
      position(s.replay.evidence, cursor),
  )!;
}
