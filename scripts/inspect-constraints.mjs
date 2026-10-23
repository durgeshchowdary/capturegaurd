import { neon } from "@neondatabase/serverless";
import { existsSync } from "node:fs";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const sql = neon(process.env.DATABASE_URL);

const rows = await sql`
  SELECT
    c.conrelid::regclass::text AS table_name,
    c.conname AS constraint_name,
    pg_get_constraintdef(c.oid) AS definition
  FROM pg_constraint c
  WHERE c.conrelid IN (
    'payment_operations'::regclass,
    'payment_events'::regclass
  )
  ORDER BY table_name, constraint_name
`;

console.log(JSON.stringify(rows, null, 2));
