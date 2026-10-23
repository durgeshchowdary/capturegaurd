import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

type OperationRow = {
  id: string;
  idempotency_key: string;
  amount_minor: string | number;
  currency: string;
  status: string;
  version: number;
  paypal_order_id: string | null;
  provider_status: string | null;
  last_error_code: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  sequence_no: number | string | null;
  event_type: string | null;
  from_status: string | null;
  to_status: string | null;
  source: string | null;
  occurred_at: string | Date | null;
};

export async function GET() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return NextResponse.json(
      { ok: false, error: "Database is not configured." },
      { status: 503 },
    );
  }

  try {
    const sql = neon(databaseUrl);

    const rows = (await sql`
      WITH recent_operations AS (
        SELECT
          id,
          idempotency_key,
          amount_minor,
          currency,
          status,
          version,
          paypal_order_id,
          provider_status,
          last_error_code,
          created_at,
          updated_at
        FROM payment_operations
        ORDER BY created_at DESC
        LIMIT 100
      )
      SELECT
        o.id,
        o.idempotency_key,
        o.amount_minor,
        o.currency,
        o.status,
        o.version,
        o.paypal_order_id,
        o.provider_status,
        o.last_error_code,
        o.created_at,
        o.updated_at,
        e.sequence_no,
        e.event_type,
        e.from_status,
        e.to_status,
        e.source,
        e.occurred_at
      FROM recent_operations o
      LEFT JOIN payment_events e ON e.operation_id = o.id
      ORDER BY o.created_at DESC, e.sequence_no ASC
    `) as unknown as OperationRow[];

    const operations = new Map<
      string,
      {
        id: string;
        idempotencyKey: string;
        amountMinor: string;
        currency: string;
        status: string;
        version: number;
        paypalOrderId: string | null;
        providerStatus: string | null;
        lastErrorCode: string | null;
        createdAt: string;
        updatedAt: string;
        events: {
          sequence: number;
          type: string;
          fromStatus: string | null;
          toStatus: string | null;
          source: string;
          occurredAt: string;
        }[];
      }
    >();

    for (const row of rows) {
      let operation = operations.get(row.id);

      if (!operation) {
        operation = {
          id: row.id,
          idempotencyKey: row.idempotency_key,
          amountMinor: String(row.amount_minor),
          currency: row.currency,
          status: row.status,
          version: Number(row.version),
          paypalOrderId: row.paypal_order_id,
          providerStatus: row.provider_status,
          lastErrorCode: row.last_error_code,
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString(),
          events: [],
        };

        operations.set(row.id, operation);
      }

      if (
        row.sequence_no !== null &&
        row.event_type !== null &&
        row.occurred_at !== null
      ) {
        operation.events.push({
          sequence: Number(row.sequence_no),
          type: row.event_type,
          fromStatus: row.from_status,
          toStatus: row.to_status,
          source: row.source ?? "system",
          occurredAt: new Date(row.occurred_at).toISOString(),
        });
      }
    }

    return NextResponse.json(
      {
        ok: true,
        operations: Array.from(operations.values()),
        count: operations.size,
        source: "neon-postgresql",
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Unable to load payment operations." },
      { status: 503 },
    );
  }
}
