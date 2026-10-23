import { neon } from "@neondatabase/serverless";
import { existsSync } from "node:fs";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing.");
}

const sql = neon(process.env.DATABASE_URL);

async function migrate() {
  await sql`
    ALTER TABLE payment_operations
    DROP CONSTRAINT IF EXISTS payment_operations_status_check
  `;

  await sql`
    ALTER TABLE payment_operations
    ADD CONSTRAINT payment_operations_status_check
    CHECK (status IN (
      'created',
      'request_in_flight',
      'awaiting_approval',
      'outcome_unknown',
      'reconciliation_required',
      'succeeded',
      'failed'
    ))
  `;

  await sql`
    ALTER TABLE payment_events
    DROP CONSTRAINT IF EXISTS payment_events_event_type_check
  `;

  await sql`
    ALTER TABLE payment_events
    ADD CONSTRAINT payment_events_event_type_check
    CHECK (event_type IN (
      'operation_created',
      'provider_request_started',
      'provider_order_created',
      'provider_timeout',
      'provider_outcome_unknown',
      'reconciliation_started',
      'provider_confirmed_success',
      'provider_confirmed_failure',
      'manual_review_required'
    ))
  `;

  await sql`
    ALTER TABLE payment_events
    DROP CONSTRAINT IF EXISTS payment_events_to_status_check
  `;

  await sql`
    ALTER TABLE payment_events
    ADD CONSTRAINT payment_events_to_status_check
    CHECK (to_status IN (
      'created',
      'request_in_flight',
      'awaiting_approval',
      'outcome_unknown',
      'reconciliation_required',
      'succeeded',
      'failed'
    ))
  `;

  console.log("PayPal lifecycle schema migration completed.");

  const result = await sql`
    SELECT
      COUNT(*) FILTER (
        WHERE status = 'awaiting_approval'
      )::int AS awaiting_approval_operations,
      COUNT(*)::int AS total_operations
    FROM payment_operations
  `;

  console.log(result[0]);
}

migrate().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
});
