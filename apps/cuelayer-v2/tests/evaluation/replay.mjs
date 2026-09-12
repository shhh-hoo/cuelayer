import { stateContract, assessResponse } from "./assessment.mjs";
import { drive } from "./driver.mjs";

// Restore the actual event prefix before its first acceptance. Let the frozen
// scheduler dispatch naturally, recording the production request without a response.
// Historical response aliases are never rebound to the new task identity.
async function probeSchedulerRecovery(product, events) {
  const boundary = events.findIndex((e) => e.type === "accepted");
  const prefix = boundary < 0 ? events : events.slice(0, boundary);
  if (!prefix.some((e) => e.type === "evidence"))
    return {
      status: "NOT_EXERCISED",
      reason: "no-preacceptance-evidence-prefix",
    };
  const store = new product.storage.EventStore(
    `gate3b-scheduler-${crypto.randomUUID()}`,
  );
  for (const event of prefix) await store.append(event, event.sequence - 1);
  let observed, timer;
  const opportunity = new Promise((r) => {
    observed = r;
  });
  const session = await product.session.Session.open(
    prefix[0].sessionId,
    async (task, signal) => {
      const request = task.review?.request ?? task.capture.request;
      observed({
        task,
        request,
        payload: await product.provider.liveRequest(request),
        observed_at: Date.now(),
      });
      await new Promise((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        else
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
      });
    },
    store,
  );
  const before = stateContract(session.replay),
    initialWindow = session.window;
  try {
    const capture = await Promise.race([
      opportunity,
      new Promise((r) => {
        timer = setTimeout(
          () => r(null),
          session.config.maxWaitMs + session.config.coalesceMs + 500,
        );
      }),
    ]);
    const unchanged =
      JSON.stringify(before) === JSON.stringify(stateContract(session.replay));
    return {
      status: capture && unchanged ? "PASS" : "FAIL",
      prefix_sequence: prefix.at(-1).sequence,
      initial_window: initialWindow,
      capture,
      semantic_state_unchanged: unchanged,
      trace: structuredClone(session.trace.spans),
      provider_invocations: 0,
      dependency_mode: "RECORDED",
    };
  } finally {
    clearTimeout(timer);
    session.close();
    await new Promise((r) => setTimeout(r, 0));
    await store.delete();
  }
}

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
    const scheduler = await probeSchedulerRecovery(product, events);
    return {
      replay_kind: "events-and-timing-to-scheduler-recovery",
      dependency_mode: "RECORDED",
      provider_invocations: 0,
      timed,
      status:
        JSON.stringify(stateContract(session.replay)) ===
        JSON.stringify(stateContract(replay))
          ? scheduler.status
          : "FAIL",
      observations,
      window: session.window,
      recovered_state: stateContract(session.replay),
      interpreter_opportunities,
      scheduler,
      limitation:
        "Replays durable event timing and Session recovery, then observes a frozen scheduler request from the original preacceptance prefix. It does not regenerate model decisions or rebind historical response aliases to fresh task IDs.",
    };
  } finally {
    session.close();
    await store.delete();
  }
}
