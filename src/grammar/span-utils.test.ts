import { describe, expect, it } from "vitest";
import { transcriptText } from "./span-utils";
import type { Transcript } from "./types";

describe("transcript surface joining", () => {
  const transcript = (tokens: Transcript["tokens"]): Transcript => ({ id: "surface", tokens });
  it("uses spaces between English words", () => expect(transcriptText(transcript([{ id: "1", text: "Nuclear", joinerBefore: "", startMs: 0, endMs: 1 }, { id: "2", text: "charge", joinerBefore: " ", startMs: 1, endMs: 2 }]))).toBe("Nuclear charge"));
  it("attaches punctuation without inserting a space", () => expect(transcriptText(transcript([{ id: "1", text: "Charge", joinerBefore: "", startMs: 0, endMs: 1 }, { id: "2", text: "increases", joinerBefore: " ", startMs: 1, endMs: 2 }, { id: "3", text: ".", joinerBefore: "", startMs: 2, endMs: 3 }]))).toBe("Charge increases."));
  it("does not invent spaces for Chinese", () => expect(transcriptText(transcript([{ id: "1", text: "核电荷", joinerBefore: "", startMs: 0, endMs: 1 }, { id: "2", text: "增加", joinerBefore: "", startMs: 1, endMs: 2 }, { id: "3", text: "。", joinerBefore: "", startMs: 2, endMs: 3 }]))).toBe("核电荷增加。"));
  it("preserves source-defined mixed Chinese and English spacing", () => expect(transcriptText(transcript([{ id: "1", text: "核电荷", joinerBefore: "", startMs: 0, endMs: 1 }, { id: "2", text: "nuclear", joinerBefore: " ", startMs: 1, endMs: 2 }, { id: "3", text: "charge", joinerBefore: " ", startMs: 2, endMs: 3 }]))).toBe("核电荷 nuclear charge"));
});
