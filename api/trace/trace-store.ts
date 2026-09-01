import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, list, put } from "@vercel/blob";
import { compareTraceEvents, prepareDurableTraceEvent, type DurableTraceEvent, type DurableTraceEventDraft } from "../../src/trace/durable-trace.ts";

declare const process: { cwd(): string; env: Record<string, string | undefined> };

const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const EVENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{7,191}$/;

function validateIdentity(value: string, pattern: RegExp, label: string): string {
  if (!pattern.test(value)) throw new Error(`invalid-${label}`);
  return value;
}

function localTraceDirectory() {
  return process.env.CUELAYER_TRACE_DIR || path.join(process.cwd(), ".cuelayer", "traces");
}

function useBlobStore() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID));
}

function localSessionDirectory(sessionId: string) {
  return path.join(localTraceDirectory(), validateIdentity(sessionId, SESSION_ID, "session-id"));
}

function localEventPath(event: DurableTraceEvent) {
  return path.join(localSessionDirectory(event.sessionId), `${validateIdentity(event.id, EVENT_ID, "event-id")}.json`);
}

function eventPath(event: DurableTraceEvent) {
  return `cuelayer-traces/${event.sessionId}/${validateIdentity(event.id, EVENT_ID, "event-id")}.json`;
}

async function readStream(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).text();
}

async function appendLocal(events: DurableTraceEvent[]) {
  await mkdir(localTraceDirectory(), { recursive: true });
  await Promise.all(events.map(async (event) => {
    await mkdir(localSessionDirectory(event.sessionId), { recursive: true });
    const serialized = JSON.stringify(event);
    try {
      await writeFile(localEventPath(event), serialized, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      if (await readFile(localEventPath(event), "utf8") !== serialized) throw new Error("trace-event-id-conflict");
    }
  }));
}

async function appendBlob(events: DurableTraceEvent[]) {
  await Promise.all(events.map(async (event) => {
    const pathname = eventPath(event);
    const serialized = JSON.stringify(event);
    try {
      await put(pathname, serialized, { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/json", cacheControlMaxAge: 60 });
    } catch (error) {
      const existing = await get(pathname, { access: "private", useCache: false });
      if (!existing || existing.statusCode !== 200 || !existing.stream || await readStream(existing.stream) !== serialized) {
        if (existing?.statusCode === 200) throw new Error("trace-event-id-conflict");
        throw error;
      }
    }
  }));
}

export async function appendTraceEvents(sessionId: string, drafts: DurableTraceEventDraft[]): Promise<DurableTraceEvent[]> {
  validateIdentity(sessionId, SESSION_ID, "session-id");
  const events = drafts.map((draft) => prepareDurableTraceEvent(sessionId, { ...draft, id: validateIdentity(draft.id, EVENT_ID, "event-id") }));
  if (useBlobStore()) await appendBlob(events);
  else if (!process.env.VERCEL) await appendLocal(events);
  else throw new Error("trace-storage-not-configured");
  return events;
}

async function readLocal(sessionId: string): Promise<DurableTraceEvent[]> {
  try {
    const directory = localSessionDirectory(sessionId);
    const files = (await readdir(directory)).filter((entry) => entry.endsWith(".json"));
    const events = await Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(directory, file), "utf8")) as DurableTraceEvent));
    return events.sort(compareTraceEvents);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
}

async function readBlob(sessionId: string): Promise<DurableTraceEvent[]> {
  const prefix = `cuelayer-traces/${validateIdentity(sessionId, SESSION_ID, "session-id")}/`;
  const blobs: Array<{ pathname: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const events = await Promise.all(blobs.map(async ({ pathname }) => {
    const result = await get(pathname, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return undefined;
    return JSON.parse(await readStream(result.stream)) as DurableTraceEvent;
  }));
  return events.filter((event): event is DurableTraceEvent => Boolean(event)).sort(compareTraceEvents);
}

export async function readTraceEvents(sessionId: string): Promise<DurableTraceEvent[]> {
  validateIdentity(sessionId, SESSION_ID, "session-id");
  if (useBlobStore()) return readBlob(sessionId);
  if (!process.env.VERCEL) return readLocal(sessionId);
  throw new Error("trace-storage-not-configured");
}

export async function listRecentTraceSessions(limit = 10): Promise<string[]> {
  if (useBlobStore()) {
    const modifiedBySession = new Map<string, number>();
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: "cuelayer-traces/", cursor, limit: 1000 });
      for (const blob of page.blobs) {
        const sessionId = blob.pathname.split("/")[1];
        if (sessionId) modifiedBySession.set(sessionId, Math.max(modifiedBySession.get(sessionId) ?? 0, new Date(blob.uploadedAt).getTime()));
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return [...modifiedBySession].sort((left, right) => right[1] - left[1]).slice(0, Math.max(1, limit)).map(([sessionId]) => sessionId);
  }
  if (process.env.VERCEL) throw new Error("trace-storage-not-configured");
  await mkdir(localTraceDirectory(), { recursive: true });
  const entries = await readdir(localTraceDirectory());
  const sessions = await Promise.all(entries.map(async (entry) => ({
    sessionId: entry,
    modifiedAt: (await stat(path.join(localTraceDirectory(), entry))).mtimeMs,
  })));
  return sessions.sort((left, right) => right.modifiedAt - left.modifiedAt).slice(0, limit).map(({ sessionId }) => sessionId);
}
