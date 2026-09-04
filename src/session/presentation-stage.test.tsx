import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createInitialTeachingState } from "../lesson-stream/teaching-state";
import { PresentationStage } from "./PresentationStage";
import { speechDebugEnabled } from "./SessionPage";
import { TeachingTraceDrawer } from "./TeachingTraceDrawer";

const speech = {
  finals: [{ id: "provider-final-0", text: "temperature increases", words: [], committedAtMs: 1 }],
  spans: [{ id: "speech-span-0", revision: 1, sourceFinalIds: ["provider-final-0"], text: "temperature increases", words: [], startMs: 0, endMs: 1, openedAtMs: 1, updatedAtMs: 1, status: "open" as const }],
  provisional: { id: "provisional-1", text: "particles move", words: [] },
};

function stage(showSpeechDebug: boolean, presentationStatus: "empty" | "ready" = "empty", stream: MediaStream | null = null) {
  return renderToStaticMarkup(<PresentationStage
    stream={stream}
    presentationStatus={presentationStatus}
    sessionStatus="active"
    speech={speech}
    speechStatus="ready"
    showSpeechDebug={showSpeechDebug}
    teachingState={createInitialTeachingState()}
    onTeachingCueExpire={() => undefined}
  />);
}

describe("session debug visibility", () => {
  it("selects the presentationless teaching surface without a shared presentation", () => {
    const html = stage(false);
    expect(html).toContain('data-presentation-mode="presentationless"');
    expect(html).not.toContain("Listening for live teaching");
  });

  it("preserves the overlay mode when a presentation stream is present", () => {
    const html = stage(false, "ready", {} as MediaStream);
    expect(html).toContain('data-presentation-mode="presentation-overlay"');
    expect(html).toContain("Live shared presentation");
    expect(html).not.toContain("temperature increases");
  });

  it("keeps realtime transcript inspection out of a normal /session", () => {
    expect(speechDebugEnabled("")).toBe(false);
    expect(stage(false)).not.toContain("speech-inspection-surface");
    expect(stage(false)).not.toContain("temperature increases");
    expect(stage(false)).not.toContain("particles move");
  });

  it("does not mount a transcript surface on the normal learner stage", () => {
    const html = stage(false);
    expect(html).not.toContain("speech-inspection-surface");
  });

  it("shows provisional and canonical-span inspection only for ?debug=speech", () => {
    expect(speechDebugEnabled("?debug=speech")).toBe(true);
    expect(speechDebugEnabled("?debug=other")).toBe(false);
    const html = stage(true);
    expect(html).toContain("speech-inspection-surface");
    expect(html).toContain("temperature increases");
    expect(html).toContain("particles move");
  });

  it("marks a selected completed trace as read-only while keeping it exportable", () => {
    const html = renderToStaticMarkup(<TeachingTraceDrawer
      sessionId="session-current"
      events={[]}
      status="healthy"
      pendingCount={0}
      droppedCount={0}
      sessions={[
        { sessionId: "session-current", status: "active", createdAt: "2026-09-03T10:00:00.000Z", updatedAt: "2026-09-03T10:00:00.000Z", appVersion: "0.1.0", environment: "test", path: "/session" },
        { sessionId: "session-completed", status: "completed", createdAt: "2026-09-03T09:00:00.000Z", updatedAt: "2026-09-03T09:10:00.000Z", completedAt: "2026-09-03T09:10:00.000Z", appVersion: "0.1.0", environment: "test", path: "/session" },
      ]}
      selectedSessionId="session-completed"
      viewingArchive
      onReload={() => undefined}
      onExport={() => undefined}
      onSelectSession={() => undefined}
    />);
    expect(html).toContain("Trace session:");
    expect(html).toContain("session-completed · completed");
    expect(html).toContain("Archived trace · read-only");
    expect(html).toContain("Export JSONL");
  });
});
