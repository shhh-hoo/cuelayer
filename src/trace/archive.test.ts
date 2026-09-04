import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { traceDraft } from "./contracts";
import { SessionTraceRuntime } from "./runtime";

const sessionA = "session-archive-test-a";
const sessionB = "session-archive-test-b";

async function deleteTraceDatabase() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("cuelayer-local-trace-v2");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("trace-test-database-blocked"));
  });
}

afterEach(async () => {
  await deleteTraceDatabase();
});

describe("completed trace archives", () => {
  it("keeps a completed session readable and exportable after a new session starts", async () => {
    const first = await SessionTraceRuntime.open({ requestedSessionId: sessionA, path: "/session", environment: "test", sourceInstanceId: "browser-test-a" });
    first.emit(traceDraft("evidence.checkpoint_committed", { runId: 1, checkpointId: "checkpoint-a", lessonSequence: 1, sourceFinalIds: ["final-a"], warningCodes: [] }));
    await first.complete("test-complete");
    first.close();

    const second = await SessionTraceRuntime.open({ requestedSessionId: sessionB, path: "/session", environment: "test", sourceInstanceId: "browser-test-b" });
    try {
      const before = (await second.listTraceSessions()).find((session) => session.sessionId === sessionA);
      expect(before).toMatchObject({ sessionId: sessionA, status: "completed", path: "/session", environment: "test" });

      const eventsBeforeExport = await second.readTraceSession(sessionA);
      const exported = await second.exportTraceSessionJsonl(sessionA);
      const exportedEvents = (await exported.text()).trim().split("\n").map((line) => JSON.parse(line));
      const after = (await second.listTraceSessions()).find((session) => session.sessionId === sessionA);
      const eventsAfterExport = await second.readTraceSession(sessionA);

      expect(exportedEvents.map((event) => event.type)).toEqual(["session.started", "evidence.checkpoint_committed", "session.ended"]);
      expect(exportedEvents.map((event) => event.eventId)).toEqual(eventsBeforeExport.map((event) => event.eventId));
      expect(eventsAfterExport.map((event) => event.eventId)).toEqual(eventsBeforeExport.map((event) => event.eventId));
      expect(after).toEqual(before);
      expect(after?.status).toBe("completed");
    } finally {
      second.close();
    }
  });

  it("seals session.ended as the final durable event and rejects later emissions", async () => {
    const runtime = await SessionTraceRuntime.open({ requestedSessionId: "session-sealed", path: "/session", environment: "test", sourceInstanceId: "browser-sealed" });
    try {
      runtime.emit(traceDraft("teaching_cue.keep", {}));
      await runtime.complete("test-complete");
      runtime.emit(traceDraft("teaching_surface.rendered", { renderId: "late", boardRevision: 1, cueRevision: 1, presentationMode: "presentationless" }));
      const exported = await runtime.exportJsonlBlob();
      const events = (await exported.text()).trim().split("\n").map((line) => JSON.parse(line));
      expect(events.map((event) => event.type)).toEqual(["session.started", "teaching_cue.keep", "session.ended"]);
      expect(events.at(-1)?.type).toBe("session.ended");
    } finally {
      runtime.close();
    }
  });
});
