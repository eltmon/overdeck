-- PAN-4294: Creem subscriptions, checkout reservations and processed webhook events.
-- No semicolons inside comments: the Miniflare test splits statements on a semicolon at line end.

CREATE TABLE subscriptions (
  subscription_id     TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  customer_id         TEXT NOT NULL,
  product_key         TEXT NOT NULL,
  status              TEXT NOT NULL,
  paid_through        INTEGER,
  founding            INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  last_event_at       INTEGER NOT NULL,
  revoked_at          INTEGER,
  cancel_requested_at INTEGER,
  cancel_done_at      INTEGER,
  cancel_attempts     INTEGER NOT NULL DEFAULT 0,
  cancel_error        TEXT
);
CREATE INDEX subscriptions_user ON subscriptions (user_id);

CREATE TABLE checkouts (
  checkout_id       TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  product_key       TEXT NOT NULL,
  founding          INTEGER NOT NULL DEFAULT 0,
  creem_checkout_id TEXT,
  subscription_id   TEXT,
  created_at        INTEGER NOT NULL,
  expires_at        INTEGER NOT NULL,
  completed_at      INTEGER
);
CREATE INDEX checkouts_user ON checkouts (user_id);

CREATE TABLE billing_events (
  event_id    TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE TABLE billing_unresolved (
  event_id        TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,
  subscription_id TEXT,
  first_seen_at   INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 1
);
