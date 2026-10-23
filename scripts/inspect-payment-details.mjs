import nextEnv from "@next/env";
import { neon } from "@neondatabase/serverless";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured.");
}

const sql = neon(process.env.DATABASE_URL);

const rows = await sql`
  SELECT
    id,
    status,
    amount_minor,
    currency,
    paypal_request_id,
    paypal_order_id,
    created_at,
    updated_at,
    NOW() AS database_time
  FROM payment_operations
  WHERE id = ${"e7a2c240-3fdd-498c-b7d6-bce3cf15ef67"}::uuid
`;

console.log(JSON.stringify(rows, null, 2));
