import { neon } from "@neondatabase/serverless";
import { existsSync } from "node:fs";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing. Check your local environment.");
}

const sql = neon(connectionString);

async function migrate() {
  await sql`
    CREATE TABLE IF NOT EXISTS payment_operations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      idempotency_key TEXT NOT NULL UNIQUE
        CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
      request_fingerprint TEXT NOT NULL
        CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
      amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
      currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      status TEXT NOT NULL DEFAULT 'created'
        CHECK (status IN (
          'created',
          'request_in_flight',
          'outcome_unknown',
          'reconciliation_required',
          'succeeded',
          'failed'
        )),
      paypal_order_id TEXT UNIQUE,
      paypal_capture_id TEXT UNIQUE,
      provider_status TEXT,
      last_error_code TEXT,
      version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_payment_operations_status_created
    ON payment_operations (status, created_at DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS payment_events (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      operation_id UUID NOT NULL
        REFERENCES payment_operations(id),
      sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
      event_type TEXT NOT NULL CHECK (event_type IN (
        'operation_created',
        'provider_request_started',
        'provider_timeout',
        'provider_outcome_unknown',
        'reconciliation_started',
        'provider_confirmed_success',
        'provider_confirmed_failure',
        'manual_review_required'
      )),
      from_status TEXT,
      to_status TEXT NOT NULL CHECK (to_status IN (
        'created',
        'request_in_flight',
        'outcome_unknown',
        'reconciliation_required',
        'succeeded',
        'failed'
      )),
      source TEXT NOT NULL CHECK (source IN (
        'system',
        'paypal',
        'operator'
      )),
      metadata JSONB NOT NULL DEFAULT '{}'::JSONB
        CHECK (jsonb_typeof(metadata) = 'object'),
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (operation_id, sequence_no)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_payment_events_operation
    ON payment_events (operation_id, sequence_no)
  `;

  await sql`
    CREATE OR REPLACE FUNCTION reject_payment_event_mutation()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'payment_events is append-only';
    END;
    $$
  `;

  await sql`
    DROP TRIGGER IF EXISTS payment_events_append_only
    ON payment_events
  `;

  await sql`
    CREATE TRIGGER payment_events_append_only
    BEFORE UPDATE OR DELETE ON payment_events
    FOR EACH ROW
    EXECUTE FUNCTION reject_payment_event_mutation()
  `;

  const result = await sql`
    SELECT
      to_regclass('public.payment_operations') IS NOT NULL
        AS operations_ready,
      to_regclass('public.payment_events') IS NOT NULL
        AS events_ready
  `;

  console.log("CaptureGuard database migration completed.");
  console.log({
    operationsTableReady: result[0].operations_ready,
    eventsTableReady: result[0].events_ready,
  });
}

migrate().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
});
