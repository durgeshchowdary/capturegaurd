import { neon } from "@neondatabase/serverless";
import { existsSync } from "node:fs";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing.");
}

const sql = neon(process.env.DATABASE_URL);

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
    'reconciliation_checked',
    'provider_confirmed_success',
    'provider_confirmed_failure',
    'manual_review_required',
    'capture_request_started'
  ))
`;

console.log("Reconciliation event migration completed.");
