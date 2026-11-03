-- PAN-4959: web sessions for the account page, and the 'account' sign-in purpose.
-- SQLite cannot alter a CHECK constraint, so auth_requests is rebuilt (rows live 10 minutes, copied anyway).
-- No semicolons inside comments: the Miniflare test splits statements on a semicolon at line end.

CREATE TABLE user_sessions (
  session_hash TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  csrf_token   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX user_sessions_user ON user_sessions (user_id);

CREATE TABLE auth_requests_new (
  state_hash TEXT PRIMARY KEY,
  purpose    TEXT NOT NULL CHECK (purpose IN ('pkce', 'device', 'admin', 'account')),
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
INSERT INTO auth_requests_new SELECT state_hash, purpose, payload, created_at, expires_at FROM auth_requests;
DROP TABLE auth_requests;
ALTER TABLE auth_requests_new RENAME TO auth_requests;
