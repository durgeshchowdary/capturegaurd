import { timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";


const transitions = {
  provider_request_started: {
    from: "created",
    to: "request_in_flight",
  },
  provider_timeout: {
    from: "request_in_flight",
    to: "outcome_unknown",
  },
  reconciliation_started: {
    from: "outcome_unknown",
    to: "reconciliation_required",
  },
} as const;

type EventType = keyof typeof transitions;

function authorized(request: Request): boolean {
  const expected = process.env.CAPTUREGUARD_INTERNAL_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!expected || !supplied) return false;

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);

  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!process.env.CAPTUREGUARD_INTERNAL_TOKEN) {
    return NextResponse.json(
      { error: "Internal API authentication is not configured." },
      { status: 503 },
    );
  }

  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  ) {
    return NextResponse.json(
      { error: "Invalid operation ID." },
      { status: 400 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("eventType" in body) ||
    typeof body.eventType !== "string" ||
    !Object.hasOwn(transitions, body.eventType)
  ) {
    return NextResponse.json(
      { error: "Unsupported lifecycle event." },
      { status: 400 },
    );
  }

  const eventType = body.eventType as EventType;
  const transition = transitions[eventType];

  try {
    const sql = neon(process.env.DATABASE_URL!);

    const changed = await sql`
      WITH changed AS (
        UPDATE payment_operations
        SET status = ${transition.to},
            version = version + 1,
            updated_at = NOW()
        WHERE id = ${id}::uuid
          AND status = ${transition.from}
        RETURNING id, status, version
      ),
      inserted AS (
        INSERT INTO payment_events (
          operation_id,
          sequence_no,
          event_type,
          from_status,
          to_status,
          source,
          metadata
        )
        SELECT
          id,
          version + 1,
          ${eventType},
          ${transition.from},
          ${transition.to},
          'system',
          '{}'::jsonb
        FROM changed
        RETURNING operation_id
      )
      SELECT changed.id, changed.status, changed.version
      FROM changed
      INNER JOIN inserted ON inserted.operation_id = changed.id
    `;

    if (changed.length > 0) {
      return NextResponse.json({
        ok: true,
        operation: changed[0],
        replayed: false,
      });
    }

    const existing = await sql`
      SELECT
        o.id,
        o.status,
        o.version,
        e.event_type AS latest_event_type
      FROM payment_operations o
      LEFT JOIN LATERAL (
        SELECT event_type
        FROM payment_events
        WHERE operation_id = o.id
        ORDER BY sequence_no DESC
        LIMIT 1
      ) e ON TRUE
      WHERE o.id = ${id}::uuid
    `;

    if (existing.length === 0) {
      return NextResponse.json(
        { error: "Operation not found." },
        { status: 404 },
      );
    }

    const operation = existing[0];

    if (
      operation.status === transition.to &&
      operation.latest_event_type === eventType
    ) {
      return NextResponse.json({
        ok: true,
        operation: {
          id: operation.id,
          status: operation.status,
          version: operation.version,
        },
        replayed: true,
      });
    }

    return NextResponse.json(
      {
        error: "Invalid lifecycle transition.",
        currentStatus: operation.status,
        expectedStatus: transition.from,
      },
      { status: 409 },
    );
  } catch (error) {
    console.error("Lifecycle transition failed:", error);

    return NextResponse.json(
      { error: "Could not record the lifecycle transition." },
      { status: 503 },
    );
  }
}
