import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile(".env.local");
}

const operationId = process.argv[2];

if (
  !operationId ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)
) {
  console.error("Usage: node scripts/verify-audit.mjs <operation-uuid>");
  process.exitCode = 1;
} else {
  const sql = neon(process.env.DATABASE_URL);

  const rows = await sql`
    SELECT
      o.id,
      o.status,
      o.version,
      COUNT(e.id)::int AS event_count,
      COALESCE(
        json_agg(
          json_build_object(
            'sequence', e.sequence_no,
            'eventType', e.event_type,
            'from', e.from_status,
            'to', e.to_status,
            'source', e.source
          )
          ORDER BY e.sequence_no
        ) FILTER (WHERE e.id IS NOT NULL),
        '[]'::json
      ) AS events
    FROM payment_operations o
    LEFT JOIN payment_events e ON e.operation_id = o.id
    WHERE o.id = ${operationId}::uuid
    GROUP BY o.id, o.status, o.version
  `;

  if (rows.length === 0) {
    console.error("Operation not found.");
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(rows[0], null, 2));
  }
}
