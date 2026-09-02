import { describe, expect, it } from "vitest";
import { createInitialTeachingCueState, DEFAULT_NOTE_DURATION_MS, teachingCueReducer } from "./runtime";

const setCue = (kind: "QUESTION" | "TASK" | "NOTE" | "HINT", id = kind.toLowerCase(), now = 100) => teachingCueReducer(createInitialTeachingCueState(), {
  type: "set",
  cue: { id, kind, text: `  ${kind.toLowerCase()}   cue  `, sourceSegmentIds: ["speech-1"] },
  now,
});

describe("Teaching Cue runtime", () => {
  it("keeps questions, tasks, and teacher hints until explicitly resolved or replaced", () => {
    for (const kind of ["QUESTION", "TASK", "HINT"] as const) {
      const state = setCue(kind);
      expect(state.active).toMatchObject({ kind, text: `${kind.toLowerCase()} cue`, sourceSegmentIds: ["speech-1"] });
      expect(state.active?.expiresAt).toBeUndefined();
      expect(teachingCueReducer(state, { type: "expire", cueId: state.active!.id, now: 999_999 })).toBe(state);
    }
  });

  it("expires NOTE independently while leaving persistent cues untouched", () => {
    const state = setCue("NOTE", "note-1", 1_000);
    expect(state.active?.expiresAt).toBe(1_000 + DEFAULT_NOTE_DURATION_MS);
    expect(teachingCueReducer(state, { type: "expire", cueId: "note-1", now: 1_000 + DEFAULT_NOTE_DURATION_MS - 1 })).toBe(state);
    expect(teachingCueReducer(state, { type: "expire", cueId: "note-1", now: 1_000 + DEFAULT_NOTE_DURATION_MS })).toEqual({});
  });

  it("lets a newer actionable cue replace the previous active cue", () => {
    const task = setCue("TASK", "task-1");
    const question = teachingCueReducer(task, { type: "set", cue: { id: "question-2", kind: "QUESTION", text: "Which pathway is faster?" }, now: 200 });
    expect(question.active).toMatchObject({ id: "question-2", kind: "QUESTION", text: "Which pathway is faster?" });
  });

  it("ignores stale resolution and blank replacement attempts", () => {
    const state = setCue("QUESTION", "question-1");
    expect(teachingCueReducer(state, { type: "resolve", cueId: "older-question" })).toBe(state);
    expect(teachingCueReducer(state, { type: "set", cue: { id: "blank", kind: "TASK", text: "   " }, now: 300 })).toBe(state);
  });
});
