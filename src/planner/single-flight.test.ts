import { describe, expect, it } from "vitest";
import { SingleFlightPlanner } from "./single-flight";

describe("canonical span planner scheduling", () => {
  it("keeps one request in flight and coalesces pending work to the newest span revision", () => {
    const scheduler = new SingleFlightPlanner();
    scheduler.enqueue([{ spanId: "speech-span-5", spanRevision: 1 }]);
    const first = scheduler.next(7)!;
    expect(first).toMatchObject({ spanId: "speech-span-5", spanRevision: 1, requestId: 1, runId: 7 });

    scheduler.enqueue([{ spanId: "speech-span-5", spanRevision: 2 }]);
    scheduler.enqueue([{ spanId: "speech-span-5", spanRevision: 3 }]);
    expect(scheduler.next(7)).toBeUndefined();

    scheduler.complete(first.requestId, first.runId);
    expect(scheduler.next(7)).toMatchObject({ spanId: "speech-span-5", spanRevision: 3, requestId: 2, runId: 7 });
  });

  it("preserves checkpoint order across distinct canonical spans", () => {
    const scheduler = new SingleFlightPlanner();
    scheduler.enqueue([
      { spanId: "speech-span-1", spanRevision: 4 },
      { spanId: "speech-span-2", spanRevision: 1 },
    ]);
    const first = scheduler.next(1)!;
    scheduler.complete(first.requestId, first.runId);
    const second = scheduler.next(1)!;
    expect([first.spanId, second.spanId]).toEqual(["speech-span-1", "speech-span-2"]);
  });

  it("updates existing pending checkpoint work without creating work for every revision", () => {
    const scheduler = new SingleFlightPlanner();
    scheduler.enqueue([{ spanId: "speech-span-0", spanRevision: 1 }]);
    const first = scheduler.next(1)!;

    scheduler.coalescePending([{ spanId: "speech-span-0", spanRevision: 2 }]);
    expect(scheduler.next(1)).toBeUndefined();

    scheduler.enqueue([{ spanId: "speech-span-0", spanRevision: 6 }]);
    scheduler.coalescePending([{ spanId: "speech-span-0", spanRevision: 7 }]);
    scheduler.coalescePending([{ spanId: "speech-span-0", spanRevision: 8 }]);
    scheduler.complete(first.requestId, first.runId);
    expect(scheduler.next(1)).toMatchObject({ spanId: "speech-span-0", spanRevision: 8 });
  });

  it("cancels a simulated ten-second obsolete call so the newest closed checkpoint starts immediately", () => {
    const scheduler = new SingleFlightPlanner();
    scheduler.enqueue([{ spanId: "speech-span-0", spanRevision: 1 }]);
    const obsolete = scheduler.next(1, 0)!;
    scheduler.enqueue([{ spanId: "speech-span-1", spanRevision: 2, closed: true }]);

    expect(obsolete.startedAtMs + 10_000).toBeGreaterThan(obsolete.startedAtMs);
    expect(scheduler.cancel(obsolete.requestId, obsolete.runId)).toEqual(obsolete);
    expect(scheduler.next(1, 10_000)).toMatchObject({ spanId: "speech-span-1", spanRevision: 2, requestId: 2, startedAtMs: 10_000 });
  });
});
