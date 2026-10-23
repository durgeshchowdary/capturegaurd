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
    ADD COLUMN IF NOT EXISTS paypal_request_id TEXT
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS
      payment_operations_paypal_request_id_unique
    ON payment_operations (paypal_request_id)
    WHERE paypal_request_id IS NOT NULL
  `;

  console.log("PayPal request ID migration completed.");
}

migrate().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
});
