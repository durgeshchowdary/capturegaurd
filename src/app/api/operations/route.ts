import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

type CreateOperationBody = {
  amountMinor?: unknown;
  currency?: unknown;
};

export async function POST(request: Request) {
  const idempotencyKey = request.headers.get("Idempotency-Key");

  if (
    !idempotencyKey ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)
  ) {
    return NextResponse.json(
      {
        error: "A valid Idempotency-Key header is required.",
        code: "INVALID_IDEMPOTENCY_KEY",
      },
      { status: 400 },
    );
  }

  let body: CreateOperationBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const amountMinor = body?.amountMinor;
  const currency =
    typeof body?.currency === "string"
      ? body.currency.toUpperCase()
      : "";

  if (
    typeof amountMinor !== "number" ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0
  ) {
    return NextResponse.json(
      {
        error: "amountMinor must be a positive safe integer.",
        code: "INVALID_AMOUNT",
      },
      { status: 400 },
    );
  }

  if (!/^[A-Z]{3}$/.test(currency)) {
    return NextResponse.json(
      {
        error: "currency must be a three-letter currency code.",
        code: "INVALID_CURRENCY",
      },
      { status: 400 },
    );
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return NextResponse.json(
      { error: "Database is not configured." },
      { status: 503 },
    );
  }

  const requestFingerprint = createHash("sha256")
    .update(JSON.stringify({ amountMinor, currency }))
    .digest("hex");

  try {
    const sql = neon(databaseUrl);

    // Create the operation and its initial audit event in one SQL statement.
    // A conflicting idempotency key cannot create a second operation.
    const inserted = await sql`
      WITH new_operation AS (
        INSERT INTO payment_operations (
          idempotency_key,
          request_fingerprint,
          amount_minor,
          currency
        )
        VALUES (
          ${idempotencyKey},
          ${requestFingerprint},
          ${amountMinor},
          ${currency}
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING *
      ),
      new_event AS (
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
          1,
          'operation_created',
          NULL,
          'created',
          'system',
          jsonb_build_object(
            'amountMinor', amount_minor,
            'currency', currency
          )
        FROM new_operation
        RETURNING operation_id
      )
      SELECT
        o.id,
        o.idempotency_key,
        o.amount_minor,
        o.currency,
        o.status,
        o.version,
        o.created_at,
        o.updated_at
      FROM new_operation o
      INNER JOIN new_event e ON e.operation_id = o.id
    `;

    if (inserted.length > 0) {
      return NextResponse.json(
        {
          operation: inserted[0],
          replayed: false,
        },
        { status: 201 },
      );
    }

    // The key already exists. Read the original request's operation.
    const existingRows = await sql`
      SELECT
        id,
        idempotency_key,
        request_fingerprint,
        amount_minor,
        currency,
        status,
        version,
        created_at,
        updated_at
      FROM payment_operations
      WHERE idempotency_key = ${idempotencyKey}
      LIMIT 1
    `;

    const existing = existingRows[0];

    if (!existing) {
      return NextResponse.json(
        {
          error: "Operation could not be resolved. Retry with the same key.",
          code: "OPERATION_RESOLUTION_REQUIRED",
        },
        { status: 503 },
      );
    }

    if (existing.request_fingerprint !== requestFingerprint) {
      return NextResponse.json(
        {
          error:
            "This idempotency key was already used for a different request.",
          code: "IDEMPOTENCY_KEY_REUSED",
        },
        { status: 409 },
      );
    }

    const safeOperation = Object.fromEntries(
      Object.entries(existing).filter(([key]) => key !== "request_fingerprint"),
    );

    return NextResponse.json(
      {
        operation: safeOperation,
        replayed: true,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      {
        error: "Unable to persist the operation. Retry with the same key.",
        code: "OPERATION_PERSISTENCE_FAILED",
      },
      { status: 503 },
    );
  }
}

