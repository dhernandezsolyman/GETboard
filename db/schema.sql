-- GETboard schema. Run against your Postgres (Neon) database.
-- Idempotent: safe to run multiple times.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  write_id    text NOT NULL UNIQUE,
  read_id     text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sequence    integer NOT NULL,
  symbol      text NOT NULL,
  token_hash  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Enforces single-use of each sequence number: the DB, not a token table,
  -- is what makes execute idempotent and race-safe.
  CONSTRAINT operations_session_sequence_unique UNIQUE (session_id, sequence)
);

CREATE INDEX IF NOT EXISTS operations_session_idx ON operations (session_id, sequence);

CREATE TABLE IF NOT EXISTS commits (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sequence    integer NOT NULL,
  text        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commits_session_idx ON commits (session_id, created_at);

CREATE TABLE IF NOT EXISTS request_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route       text NOT NULL,
  session_id  uuid REFERENCES sessions(id) ON DELETE SET NULL,
  sequence    integer,
  symbol      text,
  -- outcome: recorded | duplicate | conflict | stale | invalid_token | expired | view
  outcome     text NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS request_log_session_idx ON request_log (session_id, created_at);
