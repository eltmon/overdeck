-- overdeck.ai account service: initial schema (PRD PAN-4293 §7.3).
-- Timestamps are INTEGER milliseconds since epoch. Every secret column stores a SHA-256 hex hash (D-5).

CREATE TABLE users (
  user_id      TEXT PRIMARY KEY,                 -- crypto.randomUUID()
  github_id    INTEGER NOT NULL UNIQUE,
  github_login TEXT NOT NULL,                    -- display only; refreshed each sign-in
  created_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);

CREATE TABLE grants (
  github_id         INTEGER PRIMARY KEY,
  github_login      TEXT NOT NULL,
  entitlement       TEXT NOT NULL DEFAULT 'tester',
  storage_cap_bytes INTEGER,                     -- NULL = DEFAULT_STORAGE_CAP_BYTES (5 GB)
  note              TEXT,
  granted_at        INTEGER NOT NULL,
  expires_at        INTEGER,                     -- NULL = no expiry
  granted_via       TEXT NOT NULL CHECK (granted_via IN ('admin-add', 'admin-allow-pending'))
);

CREATE TABLE pending_attempts (
  github_id     INTEGER PRIMARY KEY,
  github_login  TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 1,
  last_flow     TEXT NOT NULL CHECK (last_flow IN ('pkce', 'device'))
);

CREATE TABLE devices (
  device_id      TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(user_id),
  token_hash     TEXT NOT NULL UNIQUE,
  platform       TEXT NOT NULL,
  label          TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  last_used_at   INTEGER,
  revoked_at     INTEGER,
  revoked_by     TEXT CHECK (revoked_by IN ('user', 'operator', 'account-deletion'))
);
CREATE UNIQUE INDEX devices_user_env_active ON devices (user_id, environment_id) WHERE revoked_at IS NULL;
CREATE INDEX devices_user ON devices (user_id);

CREATE TABLE auth_requests (
  state_hash TEXT PRIMARY KEY,
  purpose    TEXT NOT NULL CHECK (purpose IN ('pkce', 'device', 'admin')),
  payload    TEXT NOT NULL,                      -- JSON continuation params
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE auth_codes (
  code_hash      TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  redirect_uri   TEXT NOT NULL,
  platform       TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  expires_at     INTEGER NOT NULL
);

CREATE TABLE device_grants (
  device_code_hash TEXT PRIMARY KEY,
  user_code_hash   TEXT NOT NULL UNIQUE,
  platform         TEXT NOT NULL,
  environment_id   TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
  user_id          TEXT,
  interval_s       INTEGER NOT NULL DEFAULT 5,
  last_polled_at   INTEGER,
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL
);

CREATE TABLE admin_sessions (
  session_hash TEXT PRIMARY KEY,
  github_id    INTEGER NOT NULL,
  csrf_token   TEXT NOT NULL,                    -- 32 hex; useless without the hashed session cookie
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);

CREATE TABLE deletion_jobs (
  user_id         TEXT PRIMARY KEY,
  requested_at    INTEGER NOT NULL,
  holders_pending TEXT NOT NULL,                 -- JSON array of holder names still to ack
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,                          -- truncated to 200 chars
  completed_at    INTEGER
);

CREATE TABLE rate_limits (
  bucket       TEXT NOT NULL,
  client_hash  TEXT NOT NULL,                    -- sha256(CF-Connecting-IP or 'unknown')
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (bucket, client_hash)
);
