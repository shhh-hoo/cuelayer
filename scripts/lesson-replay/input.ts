import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../../src/trace/audit.ts";

const ms = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.string().min(1).max(100);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const manifestSchema = z.object({
  schemaVersion: z.literal("lesson-replay-input-v1"), lessonId: id,
  source: z.object({ title: z.string().min(1), url: z.string().url().nullable() }).strict(),
  language: z.string().min(1), playbackRange: z.object({ startMs: ms, endMs: ms }).strict(),
  timelineOriginMs: ms,
  transcriptType: z.enum(["human-subtitles", "automatic-subtitles", "asr-output", "human-corrected", "synthetic-fixture"]),
  raw: z.object({ file: z.string().min(1), sha256: hash }).strict(),
  normalized: z.object({ file: z.string().min(1), sha256: hash, rules: z.array(z.string().min(1)).min(1) }).strict(),
  timestampPrecision: z.object({ resolutionMs: ms.positive(), synthetic: z.boolean() }).strict(),
  availabilityRule: z.literal("whole-segment-at-end-or-later"),
  visualInputProvided: z.literal(false),
}).strict();
export const segmentSchema = z.object({
  segmentId: id, startMs: ms, endMs: ms, availableAtMs: ms.optional(), text: z.string().min(1),
  originalSegmentIds: z.array(id).min(1),
}).strict();
export type Segment = Omit<z.infer<typeof segmentSchema>, "availableAtMs"> & { availableAtMs: number; timingSynthetic?: boolean; parentSegmentId?: string };
export type InputManifest = z.infer<typeof manifestSchema>;
export type LoadedInput = { manifest: InputManifest; manifestHash: string; segments: Segment[]; rawPath: string; normalizedPath: string; rulesHash: string };
export const bytesHash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function loadInput(path: string): LoadedInput {
  const manifestBytes = readFileSync(path);
  const manifest = manifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  const rawPath = resolve(dirname(path), manifest.raw.file), normalizedPath = resolve(dirname(path), manifest.normalized.file);
  const raw = readFileSync(rawPath), normalized = readFileSync(normalizedPath);
  if (bytesHash(raw) !== manifest.raw.sha256 || bytesHash(normalized) !== manifest.normalized.sha256) throw new Error("input-hash-mismatch");
  const rawIds = new Set<string>();
  for (const line of raw.toString("utf8").split(/\r?\n/).filter(line => line.trim())) {
    const original = z.object({ segmentId: id, text: z.string() }).passthrough().parse(JSON.parse(line));
    if (rawIds.has(original.segmentId)) throw new Error("duplicate-raw-segment-id");
    rawIds.add(original.segmentId);
  }
  const segments = normalized.toString("utf8").split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    const parsed = segmentSchema.safeParse(JSON.parse(line));
    if (!parsed.success) throw new Error(`invalid-segment-line-${index + 1}: ${parsed.error.message}`);
    return { ...parsed.data, availableAtMs: parsed.data.availableAtMs ?? parsed.data.endMs };
  });
  if (!segments.length) throw new Error("empty-transcript");
  const ids = new Set<string>(); let previousAvailable = -1;
  const { startMs, endMs } = manifest.playbackRange;
  if (startMs >= endMs || manifest.timelineOriginMs > startMs) throw new Error("invalid-playback-range-or-origin");
  for (const segment of segments) {
    if (ids.has(segment.segmentId)) throw new Error("duplicate-segment-id");
    ids.add(segment.segmentId);
    if (segment.originalSegmentIds.some(id => !rawIds.has(id))) throw new Error(`missing-original-segment:${segment.segmentId}`);
    if (segment.startMs < startMs || segment.endMs > endMs || segment.startMs > segment.endMs || segment.availableAtMs < segment.endMs || segment.availableAtMs < previousAvailable) throw new Error(`invalid-segment-time:${segment.segmentId}`);
    previousAvailable = segment.availableAtMs;
  }
  return { manifest, manifestHash: bytesHash(manifestBytes), segments, rawPath, normalizedPath, rulesHash: bytesHash(canonicalJson(manifest.normalized.rules)) };
}

export type SplitStrategy = "original" | "sentence" | "phrase";
/** Diagnostic subdivisions retain parent availability: never invent earlier knowledge. */
export function splitSegments(segments: Segment[], strategy: SplitStrategy): Segment[] {
  if (strategy === "original") return segments;
  return segments.flatMap(segment => {
    const pieces = strategy === "sentence"
      ? segment.text.match(/[^.!?。！？]+[.!?。！？]*\s*|[.!?。！？]+\s*/gu) ?? [segment.text]
      : segment.text.match(/.{1,12}/gsu) ?? [segment.text];
    if (pieces.join("") !== segment.text) throw new Error("split-text-not-lossless");
    let offset = 0;
    return pieces.map((text, index) => {
      const start = offset; offset += text.length;
      return { ...segment, segmentId: `${segment.segmentId}~${index + 1}`, parentSegmentId: segment.segmentId, text,
        startMs: segment.startMs + Math.floor((segment.endMs - segment.startMs) * start / segment.text.length),
        endMs: segment.startMs + Math.floor((segment.endMs - segment.startMs) * offset / segment.text.length), timingSynthetic: true };
    });
  });
}
