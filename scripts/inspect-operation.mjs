import { neon } from "@neondatabase/serverless";
import { existsSync } from "node:fs";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const sql = neon(process.env.DATABASE_URL);

const rows = await sql`
  SELECT
    o.id,
    o.status,
    o.version,
    o.paypal_order_id,
    o.paypal_request_id,
    o.last_error_code,
    e.sequence_no,
    e.event_type,
    e.from_status,
    e.to_status,
    e.source
  FROM payment_operations o
  LEFT JOIN payment_events e ON e.operation_id = o.id
  WHERE o.id = 'e7a2c240-3fdd-498c-b7d6-bce3cf15ef67'::uuid
  ORDER BY e.sequence_no
`;

console.log(JSON.stringify(rows, null, 2));
