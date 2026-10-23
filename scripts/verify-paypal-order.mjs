import nextEnv from "@next/env";
import { neon } from "@neondatabase/serverless";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured.");
}

const sql = neon(process.env.DATABASE_URL);
const operationId = "7af67726-70d5-4f41-99ff-01725569fffc";

const operation = await sql`
  SELECT id, amount_minor, currency, status,
         paypal_request_id, paypal_order_id,
         provider_status, version
  FROM payment_operations
  WHERE id = ${operationId}::uuid
`;

const events = await sql`
  SELECT sequence_no, event_type, from_status, to_status,
         source, occurred_at
  FROM payment_events
  WHERE operation_id = ${operationId}::uuid
  ORDER BY sequence_no
`;

console.log(JSON.stringify({ operation, events }, null, 2));
