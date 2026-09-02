import { createHash, timingSafeEqual } from "node:crypto";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { compareTraceEvents, prepareDurableTraceEvent, type DurableTraceEvent, type DurableTraceEventDraft } from "../../src/trace/durable-trace.ts";

declare const process: { env: Record<string, string | undefined> };

const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const EVENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{7,191}$/;
const CAPABILITY = /^[a-zA-Z0-9_-]{32,256}$/;

export type TraceCapability = { writeCapability: string; readCapability: string };
export type TraceSessionProvisioning = { created: boolean };
export type TraceQuery = { after?: string; limit?: number; stage?: string; eventType?: string; apiRequestId?: string; plannerRequestId?: string; commitId?: string; cueId?: string; errorsOnly?: boolean };
export type TracePage = { events: DurableTraceEvent[]; nextCursor?: string };

type TraceCursor = { occurredAt: string; ingestId: number };
function cursorFor(row: Record<string, unknown>) { return Buffer.from(JSON.stringify({ occurredAt: new Date(String(row.occurred_at)).toISOString(), ingestId: Number(row.ingest_id) } satisfies TraceCursor)).toString("base64url"); }
function parseCursor(value: string): TraceCursor {
 try {
  const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<TraceCursor>;
  if (typeof parsed.occurredAt !== "string" || !Number.isSafeInteger(parsed.ingestId)) throw new Error();
  return parsed as TraceCursor;
 } catch { throw new Error("invalid-trace-cursor"); }
}

function validate(value: string, pattern: RegExp, label: string) { if (!pattern.test(value)) throw new Error(`invalid-${label}`); return value; }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function contentHash(event: DurableTraceEvent) { return hash(JSON.stringify({ ...event, ingestedAt: undefined })); }
function db() { const url = process.env.DATABASE_URL; if (!url) throw new Error("trace-store-unavailable"); return neon(url); }

function rowEvent(row: Record<string, unknown>): DurableTraceEvent {
 return { id: String(row.event_id), sessionId: String(row.session_id), schemaVersion: Number(row.schema_version) as 1,
  occurredAt: new Date(String(row.occurred_at)).toISOString(), ingestedAt: new Date(String(row.ingested_at)).toISOString(),
  stage: String(row.stage) as DurableTraceEvent["stage"], type: String(row.event_type), causationEventId: typeof row.causation_event_id === "string" ? row.causation_event_id : undefined,
  correlation: (row.correlation ?? {}) as DurableTraceEvent["correlation"], payload: row.payload,
  source: String(row.source) as DurableTraceEvent["source"], sourceInstanceId: String(row.source_instance_id), sourceSeq: Number(row.source_seq) };
}

async function verifyCapability(sql: NeonQueryFunction<false, false>, sessionId: string, provided: string | undefined, kind: "write" | "read") {
 if (!provided || !CAPABILITY.test(provided)) throw new Error("trace-capability-required");
 const expected = hash(provided);
 const rows = await sql.query(`SELECT ${kind}_capability_hash FROM teaching_sessions WHERE id = $1`, [sessionId]) as Array<Record<string, unknown>>;
 const stored = rows[0]?.[`${kind}_capability_hash`];
 if (typeof stored !== "string" || !timingSafeEqual(Buffer.from(stored), Buffer.from(expected))) throw new Error("trace-capability-invalid");
}

export async function createTraceSession(sessionId: string, capabilities: TraceCapability, metadata: { appVersion?: string; buildVersion?: string; environment?: string; metadata?: unknown }): Promise<TraceSessionProvisioning> {
 validate(sessionId, SESSION_ID, "session-id"); validate(capabilities.writeCapability, CAPABILITY, "write-capability"); validate(capabilities.readCapability, CAPABILITY, "read-capability"); const sql = db();
 const writeHash = hash(capabilities.writeCapability); const readHash = hash(capabilities.readCapability);
 const rows = await sql.query(`INSERT INTO teaching_sessions (id, app_version, build_version, trace_schema_version, environment, metadata, write_capability_hash, read_capability_hash)
 VALUES ($1,$2,$3,1,$4,$5::jsonb,$6,$7) ON CONFLICT (id) DO NOTHING RETURNING id`,
 [sessionId, metadata.appVersion ?? null, metadata.buildVersion ?? null, metadata.environment ?? "unknown", JSON.stringify(metadata.metadata ?? {}), writeHash, readHash]);
 if (rows.length) return { created: true };
 const existing = await sql.query("SELECT write_capability_hash, read_capability_hash FROM teaching_sessions WHERE id = $1", [sessionId]) as Array<Record<string, unknown>>;
 const row = existing[0];
 if (typeof row?.write_capability_hash !== "string" || typeof row.read_capability_hash !== "string") throw new Error("trace-store-unavailable");
 if (!timingSafeEqual(Buffer.from(row.write_capability_hash), Buffer.from(writeHash)) || !timingSafeEqual(Buffer.from(row.read_capability_hash), Buffer.from(readHash))) throw new Error("trace-session-capability-conflict");
 return { created: false };
}

export async function appendTraceEvents(sessionId: string, writeCapability: string | undefined, drafts: DurableTraceEventDraft[]): Promise<DurableTraceEvent[]> {
  validate(sessionId, SESSION_ID, "session-id");
  const events = drafts.map((draft) => prepareDurableTraceEvent(sessionId, { ...draft, id: validate(draft.id, EVENT_ID, "event-id") }));
  if (!events.length) return [];
 const sql = db(); await verifyCapability(sql, sessionId, writeCapability, "write");
 await sql.transaction(events.map((event) => sql.query(`INSERT INTO trace_events (event_id,session_id,occurred_at,source,source_instance_id,source_seq,stage,event_type,causation_event_id,correlation,payload,schema_version,content_hash)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
 [event.id,event.sessionId,event.occurredAt,event.source,event.sourceInstanceId,event.sourceSeq,event.stage,event.type,event.causationEventId ?? null,JSON.stringify(event.correlation ?? {}),JSON.stringify(event.payload),event.schemaVersion,contentHash(event)])));
 const rows = await sql.query("SELECT event_id, content_hash FROM trace_events WHERE event_id = ANY($1::text[])", [events.map((event) => event.id)]) as Array<Record<string, unknown>>;
 const hashes = new Map(rows.map((row) => [String(row.event_id), String(row.content_hash)]));
 if (events.some((event) => hashes.get(event.id) !== contentHash(event))) throw new Error("trace-event-id-conflict");
 return events;
}

export async function readTraceEvents(sessionId: string, readCapability: string | undefined, query: TraceQuery = {}): Promise<TracePage> {
 validate(sessionId, SESSION_ID, "session-id"); const sql = db(); await verifyCapability(sql, sessionId, readCapability, "read");
 const limit = Math.min(250, Math.max(1, query.limit ?? 100)); const clauses = ["session_id = $1"]; const values: unknown[] = [sessionId];
 const add = (clause: string, value: unknown) => { values.push(value); clauses.push(clause.replace("?", `$${values.length}`)); };
 if (query.after) {
  const cursor = parseCursor(query.after);
  values.push(cursor.occurredAt, cursor.ingestId);
  clauses.push(`(occurred_at, ingest_id) > ($${values.length - 1}, $${values.length})`);
 }
 if (query.stage) add("stage = ?", query.stage); if (query.eventType) add("event_type = ?", query.eventType);
 if (query.apiRequestId) add("correlation->>'apiRequestId' = ?", query.apiRequestId); if (query.plannerRequestId) add("correlation->>'plannerRequestId' = ?", query.plannerRequestId);
 if (query.commitId) add("correlation->>'commitId' = ?", query.commitId); if (query.cueId) add("correlation->>'cueId' = ?", query.cueId);
 if (query.errorsOnly) clauses.push("(event_type LIKE '%failed' OR event_type LIKE '%aborted' OR event_type LIKE '%timed_out' OR event_type LIKE '%error%')");
 values.push(limit + 1);
 const rows = await sql.query(`SELECT * FROM trace_events WHERE ${clauses.join(" AND ")} ORDER BY occurred_at, ingest_id LIMIT $${values.length}`, values) as Array<Record<string, unknown>>;
 const events = rows.slice(0, limit).map(rowEvent).sort(compareTraceEvents);
 return { events, ...(rows.length > limit && rows[limit - 1] ? { nextCursor: cursorFor(rows[limit - 1]) } : {}) };
}

export async function endTraceSession(sessionId: string, writeCapability: string | undefined) {
 const sql = db(); await verifyCapability(sql, sessionId, writeCapability, "write"); await sql.query("UPDATE teaching_sessions SET ended_at = now() WHERE id = $1", [sessionId]);
}
