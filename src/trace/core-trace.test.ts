import { expect, it, vi } from "vitest";
import { CoreTrace, coreProviderResponseAudit } from "../lesson-stream/core/trace.ts";
import { CoreLiveSession } from "../lesson-stream/core/live-session.ts";
import { createCoreLiveInterpreter } from "../../server/teaching/core/live-interpreter.ts";
import { closedSpan, MemoryCoreStore, proposalFor } from "../lesson-stream/core/live-test-fixtures.ts";
import { persistedAuditDigest } from "./audit.ts";
import { prepareTraceEvent, sanitizeTraceEvent, type SessionTraceDraft, type SessionTraceEvent } from "./contracts.ts";
import { TraceWriter } from "./writer.ts";

it("persists full Core steps/provenance through the existing trace writer with matching safe digests", async () => {
  const events: SessionTraceEvent[] = [];
  const writer = new TraceWriter("core-trace", "source", async batch => { events.push(...batch.map(sanitizeTraceEvent)); });
  const live = await CoreLiveSession.open({ lessonDomain: "core", sessionId: "core-trace", speechRunId: "run", store: new MemoryCoreStore(), trace: draft => writer.emit(draft),
    interpreter: createCoreLiveInterpreter("fixture", async request => ({ output_text: JSON.stringify(proposalFor({ context: JSON.parse(request.input[1]!.content) }, true)) })) });
  await live.commitClosedSpan(closedSpan()); await live.currentAttempt; await writer.flush();
  const accepted = events.find(e => e.type === "core.accepted");
  if (accepted?.type !== "core.accepted") throw new Error("expected-accepted");
  expect(accepted.payload.eventsDigest).toBe(persistedAuditDigest(accepted.payload.events));
  expect(JSON.stringify(accepted)).not.toContain("OMITTED_MAX_DEPTH");
  const op = accepted.payload.steps[0]!.knowledgeOps[1]!;
  expect(op).toMatchObject({ value: { provenance: { speechRefs: [{ quote: "Synthetic A relates to B." }] } } });
  expect(events.find(e => e.type === "core.published")?.payload).toMatchObject({ stateDigest: persistedAuditDigest(live.state) });
  live.close(); writer.close();
});
it("bounds rejected raw output and redacts secrets before observers/writers see it", () => {
  const drafts: SessionTraceDraft[] = [];
  const trace = new CoreTrace(draft => drafts.push(draft));
  const audit = coreProviderResponseAudit({ output_text: "sk-abcdefghijk " + "x".repeat(80_000), status: "completed", authorization: "secret" });
  trace.record("core.provider_response", () => ({ ...audit, elapsedMs: 1, responseDigest: persistedAuditDigest(audit.response) }));
  expect(audit.truncated).toBe(true); expect(audit.response).toHaveProperty("output_text");
  const serialized = JSON.stringify(drafts);
  expect(serialized.length).toBeLessThan(66_000); expect(serialized).not.toContain("sk-abcdefghijk"); expect(serialized).not.toContain('"authorization"');
});
it("isolates diagnostic payload construction failure", () => {
  const emit = vi.fn(), trace = new CoreTrace(emit);
  expect(() => trace.record("core.finalization", () => { throw new Error("diagnostic"); })).not.toThrow(); expect(emit).not.toHaveBeenCalled();
});
it("continues reading unchanged legacy trace versions alongside additive Core records", () => {
  const legacy = prepareTraceEvent("legacy", "source", 1, { type: "board.keep", payload: { reason: "unchanged" } });
  const v2: SessionTraceEvent = { ...legacy, schemaVersion: 2 };
  expect(sanitizeTraceEvent(v2)).toEqual(v2); expect(legacy.schemaVersion).toBe(3);
  const core = prepareTraceEvent("core", "source", 2, { type: "core.finalization", payload: { status: "ended", pendingCount: 0 } });
  expect(sanitizeTraceEvent(core)).toEqual(core);
});
