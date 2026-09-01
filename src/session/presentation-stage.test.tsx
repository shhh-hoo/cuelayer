import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createInitialCaptionRuntime } from "../planner/caption-runtime";
import { PresentationStage } from "./PresentationStage";
import { developmentSpeechDebugEnabled, speechDebugEnabled } from "./SessionPage";
import { TeachingTraceDrawer } from "./TeachingTraceDrawer";
import { prepareDurableTraceEvent } from "../trace/durable-trace";

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
    captionRuntime={createInitialCaptionRuntime()}
    onCaptionExpire={() => undefined}
    onLearnerCueExpire={() => undefined}
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
    expect(html).not.toContain("semantic-caption");
    expect(html).not.toContain("temperature increases");
  });

  it("keeps realtime transcript inspection out of a normal /session", () => {
    expect(speechDebugEnabled("")).toBe(false);
    expect(stage(false)).not.toContain("speech-inspection-surface");
    expect(stage(false)).toContain("temperature increases");
    expect(stage(false)).not.toContain("particles move");
  });

  it("shows provisional and canonical-span inspection only for ?debug=speech", () => {
    expect(speechDebugEnabled("?debug=speech")).toBe(true);
    expect(speechDebugEnabled("?debug=planner")).toBe(false);
    const html = stage(true);
    expect(html).toContain("speech-inspection-surface");
    expect(html).toContain("temperature increases");
    expect(html).toContain("particles move");
  });

  it("enables the injector only for the development speech-debug condition", () => {
    expect(developmentSpeechDebugEnabled(true, "?debug=speech")).toBe(true);
    expect(developmentSpeechDebugEnabled(false, "?debug=speech")).toBe(false);
    expect(developmentSpeechDebugEnabled(true, "")).toBe(false);
  });

  it("renders a compact expandable structured trace", () => {
    const event = prepareDurableTraceEvent("session-test-0001", { id: "test-event", timestamp: new Date(1).toISOString(), stage: "speechmatics", type: "asr.final", correlation: { speechEventId: "provider-event-1", commitId: "committed-0" }, payload: { transcript: "temperature increases" }, source: "browser" });
    const props = { sessionId: "session-test-0001", events: [event], status: "healthy" as const, pendingCount: 0, onReload: () => undefined, onExport: () => undefined };
    const html = renderToStaticMarkup(<TeachingTraceDrawer {...props} />);
    expect(html).toContain("Persistent trace · 1 events");
    expect(html).toContain("ASR.FINAL");
    expect(html).toContain("temperature increases");
    expect(html).not.toContain("Inject downstream");

    const developmentHtml = renderToStaticMarkup(<TeachingTraceDrawer {...props} onInject={() => undefined} />);
    expect(developmentHtml).toContain("Inject downstream");
    expect(developmentHtml).toContain("FOCUS");
    expect(developmentHtml).toContain("TRANSFORM");
  });
});
