import { exclusive } from "./evidence.mjs";
import { resolve } from "node:path";
import { assessProjection } from "./projection.mjs";
import { sha256 } from "./evidence.mjs";
import { loadScenarios, loadCanaryContracts } from "./assets.mjs";

// Authored responses establish declared preconditions only. Requests are never patched.
export const wait = (task) => ({
  scope: task.capture.namespace,
  groups: [],
  suffixStatus: "WAIT_MORE_INPUT",
  contextRequest: null,
  reviewRequests: [],
  attentionCandidate: null,
});
export const full = (task, outcome = "NO_CHANGE") => ({
  ...wait(task),
  suffixStatus: "NONE",
  groups: [
    {
      outcome,
      throughBoundary: task.capture.request.source.end,
      ...(outcome === "CARRY"
        ? { kind: "INCOMPLETE_PROPOSITION", core: null }
        : {}),
    },
  ],
});
export const still = (task) => ({
  scope: task.review.namespace,
  results: task.review.items.map((i) => ({
    item: i.id,
    outcome: "STILL_OPEN",
  })),
});
export function establish(product, task, quote, meaning) {
  const c = task.capture,
    r = c.request,
    basis = product.fixture.fixtureBasis(task, quote, r.source.source),
    core = r.currentCore ?? r.cores[0]?.id ?? r.newCores[0];
  const id = r.units[0]?.id ?? r.newUnits[0],
    before = task.state.units[c.units[id]],
    operations = [];
  if (!r.cores.length)
    operations.push(
      { type: "core", id: core, label: "Teaching", basis },
      { type: "mainline", coreId: core, basis },
    );
  if (before)
    operations.push(
      ...product.fixture.authoredRevisions(
        id,
        before.meaning,
        meaning,
        (x) => Object.keys(c.units).find((k) => c.units[k] === x),
        basis,
      ),
    );
  else
    operations.push({
      type: "put",
      id,
      coreId: core,
      meaning: product.wire.projectMeaning(meaning, (x) => x),
      dependencies: [],
      basis,
    });
  return {
    ...full(task),
    groups: [
      {
        outcome: "APPLY",
        throughBoundary: r.source.end,
        operations,
        resolutions: [],
      },
    ],
    attentionCandidate: { targets: [id], mode: "FOCUS" },
  };
}
export async function admit(session, text, id) {
  const i = session.replay.evidence.length;
  await session.commitEvidence({
    id: id ?? `e${i}`,
    run: session.id,
    source: String(i),
    text,
    start: i,
    end: i + 1,
    receivedAt: performance.now(),
    audioObservedAt: null,
    stability: "COMMITTED",
  });
}
const pressure = (value) => ({
  kind: "quantity",
  expression: ["Equal", "P", value],
  symbols: { P: { label: "total pressure", unit: "kPa" } },
  conditions: [],
});
const area = {
  kind: "quantity",
  expression: ["Equal", "A", ["Multiply", "l", "w"]],
  symbols: {
    A: { label: "rectangle area", unit: "m²" },
    l: { label: "length", unit: "m" },
    w: { label: "width", unit: "m" },
  },
  conditions: [],
};
export { area, pressure };

export async function generateCanaries(
  product,
  root,
  { generationContract = null } = {},
) {
  await import("fake-indexeddb/auto");
  const snapshots = [],
    scenarios = await loadScenarios(),
    stageContracts = await loadCanaryContracts();
  for (const [i, id] of [
    "quantitative",
    "cross-fragment-condition",
    "correction-authority",
    "unresolved-reference",
    "stage-insufficient",
    "stage-clarified",
  ].entries()) {
    const session = await product.session.Session.open(
      `canary-${id}`,
      async (t) => (t.lane === "Stage" ? still(t) : wait(t)),
      new product.storage.EventStore(`canary-${crypto.randomUUID()}`),
    );
    session.pause();
    const recipe = [];
    const input = async (text, eventId) => {
      recipe.push({ type: "transcript", event_id: eventId, text });
      await admit(session, text, eventId);
    };
    const accept = async (task, response) => {
      recipe.push({ type: "accepted-precondition", task, response });
      await session.accept(task, response);
      session.pause();
    };
    let task,
      expected,
      requirements = {};
    try {
      if (i === 0) {
        for (const event of scenarios.find(
          (s) => s.scenario_id === "mathematics",
        ).transcript_events)
          await input(event.text, event.event_id);
        task = session.capture("Live");
        expected = establish(
          product,
          task,
          session.replay.evidence.map((e) => e.text).join(" "),
          area,
        );
      } else if (i === 1) {
        for (const event of scenarios.find(
          (s) => s.scenario_id === "fragmented-chemistry",
        ).transcript_events)
          await input(event.text, event.event_id);
        task = session.capture("Live");
        expected = full(task);
      } else if (i === 2) {
        const events = scenarios.find(
          (s) => s.scenario_id === "correction",
        ).transcript_events;
        await input(events[0].text, "e0");
        const t = session.capture("Live");
        await accept(t, establish(product, t, events[0].text, pressure(200)));
        await input(events[1].text, "e1");
        task = session.capture("Live");
        expected = establish(
          product,
          task,
          session.replay.evidence[1].text,
          pressure(250),
        );
        requirements = { required_units: Object.keys(session.state.units) };
      } else if (i === 3) {
        for (const event of scenarios.find(
          (s) => s.scenario_id === "unresolved-reference",
        ).transcript_events)
          await input(event.text, event.event_id);
        task = session.capture("Live");
        expected = full(task, "CARRY");
        expected.groups[0].kind = "UNRESOLVED_REFERENCE";
      } else {
        await input("A mole fraction is a ratio of amounts.", "e0");
        const t = session.capture("Live");
        await accept(
          t,
          establish(product, t, session.replay.evidence[0].text, {
            kind: "statement",
            text: "A mole fraction is a ratio of amounts.",
          }),
        );
        await input("That fraction determines its share.", "e1");
        const carry = session.capture("Live"),
          d = full(carry, "CARRY");
        d.groups[0].core = carry.capture.request.cores[0].id;
        await accept(carry, d);
        if (i === 5) {
          await input(
            "By that fraction I mean the mole fraction; by its share I mean the component's share of total pressure.",
            "e2",
          );
          const clue = session.capture("Live");
          await accept(clue, full(clue));
        }
        task = session.capture("Stage");
        expected = still(task);
        requirements = {
          required_obligations: Object.keys(session.replay.unresolved),
          required_units: Object.keys(session.state.units),
          allow_context_request: i === 4,
          semantic_clarification_missing: i === 4,
        };
        if (i === 5) {
          const r = task.review.request,
            id = r.newUnits[0],
            target = r.units[0].id;
          const basis = [
            ...product.fixture.fixtureBasis(
              task,
              session.replay.evidence[1].text,
            ),
            ...product.fixture.fixtureBasis(
              task,
              session.replay.evidence[2].text,
            ),
          ];
          expected.results[0] = {
            item: r.items[0].id,
            outcome: "RESOLVED",
            operations: [
              {
                type: "put",
                id,
                coreId: r.cores[0].id,
                meaning: {
                  kind: "annotation",
                  target,
                  text: "Mole fraction determines a component's share of total pressure.",
                },
                dependencies: [{ target, kind: "IDENTITY" }],
                basis,
              },
            ],
            resolution: {
              targets: [id],
              ...(generationContract === "cuelayer-v2-shared-execution-1"
                ? { referents: [target] }
                : {}),
              basis,
            },
          };
        }
      }
      const prestate = session.replay,
        request = task.review?.request ?? task.capture.request,
        payload = await product.provider.liveRequest(request);
      const projection = assessProjection(
        { task, replay: prestate, request },
        requirements,
      );
      const precondition_events = await session.store.read(session.id);
      const validation_clock_interval = { before: Date.now(), after: null };
      let fixture_acceptance_error = null;
      try {
        await session.accept(task, expected);
      } catch (e) {
        fixture_acceptance_error = e.message;
      }
      validation_clock_interval.after = Date.now();
      const snapshot = {
        snapshot_id: id,
        dependency_mode: "STUB",
        purpose:
          "canary request generation; authored response is a mechanical probe, not semantic gold",
        provider_invocations: 0,
        oracle_reference:
          i < 4
            ? {
                scenario_id: [
                  "mathematics",
                  "fragmented-chemistry",
                  "correction",
                  "unresolved-reference",
                ][i],
                predicate_ids: ["meaning"],
                contract_sha256: sha256(
                  scenarios.find(
                    (s) =>
                      s.scenario_id ===
                      [
                        "mathematics",
                        "fragmented-chemistry",
                        "correction",
                        "unresolved-reference",
                      ][i],
                  ),
                ),
              }
            : {
                scenario_id: id,
                predicate_ids: [
                  "stage-disposition",
                  i === 4 ? "no-invented-resolution" : "stage-meaning",
                ],
                contract_sha256: sha256(
                  stageContracts.find((s) => s.scenario_id === id),
                ),
              },
        generation: {
          ...(generationContract ? { contract: generationContract } : {}),
          recipe,
          precondition_events,
          production_capture: true,
          production_builder: true,
        },
        task,
        prestate,
        request,
        payload,
        payload_sha256: sha256(payload),
        requirements,
        projection,
        fixture_response: expected,
        fixture_acceptance_error,
        validation_clock_interval,
        fixture_poststate: session.replay,
        fixture_events: await session.store.read(session.id),
      };
      if (root) await exclusive(resolve(root, `${id}.json`), snapshot);
      snapshots.push(snapshot);
    } finally {
      session.close();
    }
  }
  return snapshots;
}
