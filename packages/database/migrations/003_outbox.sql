CREATE TABLE IF NOT EXISTS outbox_messages (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  status text NOT NULL,
  recipient text NOT NULL,
  message_type text NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS outbox_dispatch_idx
  ON outbox_messages (status, next_attempt_at, created_at);
