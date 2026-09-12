import { stateContract, assessResponse } from "./assessment.mjs";
import { drive } from "./driver.mjs";

export function replayResponse(product, snapshot) {
  return {
    replay_kind: "response-to-parser-acceptance",
    dependency_mode: "RECORDED",
    provider_invocations: 0,
    ...assessResponse(product, {
      task: snapshot.task,
      prestate: snapshot.prestate,
      response: snapshot.response ?? snapshot.fixture_response,
      events: snapshot.events ?? snapshot.fixture_events,
      poststate: snapshot.poststate ?? snapshot.fixture_poststate,
      validation_clock_interval: snapshot.validation_clock_interval,
    }),
  };
}
export async function replayEvents(product, events, { timed = false } = {}) {
  if (!events.length) throw Error("replay-events-missing");
  const store = new product.storage.EventStore(
      `gate3b-recovery-${crypto.randomUUID()}`,
    ),
    observations = [];
  let replay = product.contract.emptyReplay();
  const append = async (event) => {
    await store.append(event, event.sequence - 1);
    replay = product.contract.fold(replay, event);
    observations.push({
      sequence: event.sequence,
      at: event.at,
      accounted: replay.accounted,
      recorded: replay.recorded,
      unresolved: replay.unresolved,
    });
  };
  const elapsed = events.at(-1).at - events[0].at;
  if (timed)
    await drive(
      events.map((e) => ({
        event_id: e.id,
        at_ms: e.at - events[0].at,
        event: e,
      })),
      elapsed,
      (row) => append(row.event),
    );
  else for (const event of events) await append(event);
  let interpreter_opportunities = 0;
  const session = await product.session.Session.open(
    events[0].sessionId,
    async () => {
      interpreter_opportunities++;
      throw Error("recovery-replay-model-port-disabled");
    },
    store,
  );
  session.pause();
  try {
    return {
      replay_kind: "events-and-timing-to-scheduler-recovery",
      dependency_mode: "RECORDED",
      provider_invocations: 0,
      timed,
      status:
        JSON.stringify(stateContract(session.replay)) ===
        JSON.stringify(stateContract(replay))
          ? "PASS"
          : "FAIL",
      observations,
      window: session.window,
      recovered_state: stateContract(session.replay),
      interpreter_opportunities,
      limitation:
        "Replays durable event timing and Session recovery. It does not regenerate model decisions or rebind historical response aliases to fresh task IDs.",
    };
  } finally {
    session.close();
    await store.delete();
  }
}
