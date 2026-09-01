-- Neon source of truth. The application has the same idempotent schema bootstrap for cold starts.
CREATE TABLE IF NOT EXISTS teaching_sessions (
  id TEXT PRIMARY KEY, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), ended_at TIMESTAMPTZ,
  app_version TEXT, build_version TEXT, trace_schema_version INTEGER NOT NULL, environment TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb, write_capability_hash TEXT NOT NULL, read_capability_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trace_events (
  ingest_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, event_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES teaching_sessions(id) ON DELETE CASCADE, occurred_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(), source TEXT NOT NULL, source_instance_id TEXT NOT NULL,
  source_seq BIGINT NOT NULL, stage TEXT NOT NULL, event_type TEXT NOT NULL, causation_event_id TEXT,
  correlation JSONB NOT NULL DEFAULT '{}'::jsonb, payload JSONB NOT NULL, schema_version INTEGER NOT NULL, content_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS trace_events_session_occurred_idx ON trace_events(session_id, occurred_at, ingest_id);
CREATE INDEX IF NOT EXISTS trace_events_session_stage_idx ON trace_events(session_id, stage);
CREATE INDEX IF NOT EXISTS trace_events_session_type_idx ON trace_events(session_id, event_type);
