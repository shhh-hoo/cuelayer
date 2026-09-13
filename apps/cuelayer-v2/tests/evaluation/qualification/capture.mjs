import { sha256 } from "../evidence.mjs";
import { validateMicroCorpus } from "./contract.mjs";

const waiting = (task) => ({
  scope: task.capture?.namespace ?? "offline",
  groups: [],
  suffixStatus: "WAIT_MORE_INPUT",
  contextRequest: null,
  reviewRequests: [],
  attentionCandidate: null,
});
export async function generateMicroSnapshots(product, rawCorpus) {
  await import("fake-indexeddb/auto");
  const corpus = validateMicroCorpus(rawCorpus),
    snapshots = [];
  for (const specification of corpus.pairs.flatMap((p) => p.cases)) {
    const store = new product.storage.EventStore(
      "micro-" + crypto.randomUUID(),
    );
    const session = await product.session.Session.open(
      "micro-" + specification.case_id,
      async (t) =>
        t.lane === "Live"
          ? waiting(t)
          : {
              scope: t.review.namespace,
              results: t.review.request.items.map((item) => ({
                item: item.id,
                outcome: "STILL_OPEN",
              })),
            },
      store,
    );
    session.pause();
    const unitKeys = {},
      recipe = [];
    let next = 0;
    async function admitThrough(end) {
      for (; next <= end; next++) {
        const e = specification.evidence[next];
        await session.commitEvidence({
          id: e.event_id,
          run: session.id,
          source: String(next),
          text: e.text,
          start: next,
          end: next + 1,
          receivedAt: performance.now(),
          audioObservedAt: null,
          stability: "COMMITTED",
        });
        recipe.push({ type: "transcript", ...e });
      }
    }
    try {
      for (const step of specification.setup) {
        const last = specification.evidence.findIndex(
          (e) => e.event_id === step.evidence_refs.at(-1),
        );
        await admitThrough(last);
        const task = session.capture("Live"),
          r = task.capture.request;
        const basisFor = (ids) =>
          ids.flatMap((id) =>
            product.fixture.fixtureBasis(
              task,
              specification.evidence.find((e) => e.event_id === id).text,
              r.source.source,
            ),
          );
        const basis = basisFor(step.evidence_refs);
        let group = { outcome: step.action, throughBoundary: r.source.end };
        if (step.action === "CARRY")
          group = {
            ...group,
            kind: step.kind,
            core: step.core === null ? null : (r.currentCore ?? r.cores[0]?.id),
          };
        if (step.action === "ESTABLISH") {
          const core = r.currentCore ?? r.cores[0]?.id ?? r.newCores[0];
          const operations = [];
          if (!r.cores.length)
            operations.push(
              { type: "core", id: core, label: "Teaching", basis },
              { type: "mainline", coreId: core, basis },
            );
          for (const [index, u] of step.units.entries()) {
            const id = r.newUnits[index];
            if (!id) throw Error("insufficient-issued-unit-ids");
            const meaning = product.wire.projectMeaning(
              u.meaning,
              (role) =>
                Object.entries(task.capture.units).find(
                  ([, canonical]) => canonical === unitKeys[role],
                )?.[0] ?? role,
            );
            let operation = product.fixture.authoredPut({
              type: "put",
              id,
              coreId: core,
              meaning,
              dependencies: [],
              basis,
            });
            if (step.field_sources?.[u.key])
              operation = {
                ...operation,
                fieldBasis: Object.entries(step.field_sources[u.key]).map(
                  ([field, ids]) => ({ field, basis: basisFor(ids) }),
                ),
              };
            operations.push(operation);
            unitKeys[u.key] = task.capture.units[id];
          }
          group = {
            outcome: "APPLY",
            throughBoundary: r.source.end,
            operations,
            resolutions: [],
          };
        }
        const response = {
          ...waiting(task),
          suffixStatus: "NONE",
          groups: [group],
        };
        await session.accept(task, response);
        session.pause();
        recipe.push({ type: "accepted-precondition", task, response });
      }
      await admitThrough(specification.evidence.length - 1);
      const task = session.capture(specification.lane),
        request = task.review?.request ?? task.capture.request;
      if (specification.lane === "Stage" && !request.items.length)
        throw Error("stage-case-not-reachable:" + specification.case_id);
      const payload = await product.provider.liveRequest(request);
      snapshots.push({
        identity: "cuelayer-v2-semantic-snapshot-1",
        snapshot_id: specification.case_id,
        specification_sha256: sha256(specification),
        oracle: specification.oracle,
        generation: {
          contract: corpus.identity,
          recipe,
          precondition_events: await store.read(session.id),
          production_capture: true,
          production_builder: true,
        },
        unit_keys: unitKeys,
        task,
        prestate: structuredClone(session.replay),
        request,
        payload,
        payload_sha256: sha256(payload),
        provider_invocations: 0,
      });
    } catch (error) {
      throw new Error(specification.case_id + ":" + error.message, {
        cause: error,
      });
    } finally {
      session.close();
      await store.delete();
    }
  }
  return snapshots;
}
