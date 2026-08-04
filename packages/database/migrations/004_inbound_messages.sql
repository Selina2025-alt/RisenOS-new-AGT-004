CREATE TABLE IF NOT EXISTS inbound_messages (
  message_id text NOT NULL,
  idempotency_key text NOT NULL,
  organization_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED')),
  received_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, message_id),
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS inbound_messages_received_idx
  ON inbound_messages (received_at);
