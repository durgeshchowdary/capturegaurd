import { timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import {
  createPayPalOrder,
  getPayPalAccessToken,
  PayPalError,
} from "@/lib/paypal";

function authorized(request: Request): boolean {
  const expected = process.env.CAPTUREGUARD_INTERNAL_TOKEN;
  const supplied = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");

  if (!expected || !supplied) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);

  return a.length === b.length && timingSafeEqual(a, b);
}

function validId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
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

  if (!validId(id)) {
    return NextResponse.json({ error: "Invalid operation ID." }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    const rows = await sql`
      SELECT id, amount_minor, currency, status, paypal_order_id, paypal_request_id
      FROM payment_operations
      WHERE id = ${id}::uuid
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Operation not found." }, { status: 404 });
    }

    const operation = rows[0];

    if (operation.status !== "created" || operation.paypal_request_id) {
      return NextResponse.json(
        {
          error: "This operation cannot create another PayPal order.",
          operation: {
            id: operation.id,
            status: operation.status,
            paypalOrderId: operation.paypal_order_id,
          },
          action: "Inspect the existing operation and reconcile its provider state before proceeding.",
        },
        { status: 409 },
      );
    }

    if (operation.currency !== "USD") {
      return NextResponse.json(
        { error: "PayPal order creation currently supports USD only." },
        { status: 422 },
      );
    }

    const amountMinor = Number(operation.amount_minor);

    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      return NextResponse.json(
        { error: "Operation amount is outside the supported range." },
        { status: 422 },
      );
    }

    // Authenticate before claiming the operation; token failures cannot have
    // created an order and therefore do not leave the operation in flight.
    let accessToken: string;

    try {
      const token = await getPayPalAccessToken();
      accessToken = token.accessToken;
    } catch (error) {
      if (error instanceof PayPalError) {
        console.error("[CaptureGuard] PayPal order creation error", {
          providerStatus: error.providerStatus,
          diagnostic: error.message,
        });

        return NextResponse.json(
          { error: error.message, code: "PAYPAL_AUTHENTICATION_FAILED" },
          { status: error.providerStatus === 401 ? 502 : 503 },
        );
      }
      return NextResponse.json(
        { error: "Could not authenticate with PayPal Sandbox." },
        { status: 503 },
      );
    }

    // Atomically claim the operation and append the start event before
    // making the external request. The operation UUID is the stable request ID.
    const claimed = await sql`
      WITH changed AS (
        UPDATE payment_operations
        SET status = 'request_in_flight',
            paypal_request_id = id::text,
            version = version + 1,
            updated_at = NOW()
        WHERE id = ${id}::uuid
          AND status = 'created'
          AND paypal_request_id IS NULL
        RETURNING id, amount_minor, currency, status, version, paypal_request_id
      ),
      inserted AS (
        INSERT INTO payment_events (
          operation_id, sequence_no, event_type,
          from_status, to_status, source, metadata
        )
        SELECT
          id, version + 1, 'provider_request_started',
          'created', 'request_in_flight', 'system',
          jsonb_build_object('paypalRequestId', paypal_request_id)
        FROM changed
        RETURNING operation_id
      )
      SELECT changed.*
      FROM changed
      INNER JOIN inserted ON inserted.operation_id = changed.id
    `;

    if (claimed.length === 0) {
      const current = await sql`
        SELECT id, status, paypal_order_id
        FROM payment_operations
        WHERE id = ${id}::uuid
        LIMIT 1
      `;

      return NextResponse.json(
        {
          error: "The operation was claimed by another request or has already changed.",
          operation: current[0] ?? null,
        },
        { status: 409 },
      );
    }

    let order;

    try {
      order = await createPayPalOrder({
        accessToken,
        requestId: String(claimed[0].paypal_request_id),
        operationId: id,
        amountMinor,
        currency: String(operation.currency),
      });
    } catch (error) {
      // Once the order POST has been attempted, assume the provider may have
      // accepted it. Never reset to created or automatically issue another POST.
      try {
        await sql`
          WITH changed AS (
            UPDATE payment_operations
            SET status = 'outcome_unknown',
                last_error_code = 'PAYPAL_ORDER_OUTCOME_UNKNOWN',
                version = version + 1,
                updated_at = NOW()
            WHERE id = ${id}::uuid
              AND status = 'request_in_flight'
            RETURNING id, version
          )
          INSERT INTO payment_events (
            operation_id, sequence_no, event_type,
            from_status, to_status, source, metadata
          )
          SELECT
            id, version + 1, 'provider_outcome_unknown',
            'request_in_flight', 'outcome_unknown', 'system',
            jsonb_build_object('reason', 'provider_response_unconfirmed')
          FROM changed
        `;
      } catch {
        // Keep the original in-flight record if the database is unavailable.
        // It still blocks another order submission.
      }

      if (error instanceof PayPalError) {
        console.error("[CaptureGuard] PayPal order creation error", {
          providerStatus: error.providerStatus,
          diagnostic: error.message,
        });

        return NextResponse.json(
          {
            error: "PayPal did not provide a confirmed order result.",
            code: "PAYPAL_ORDER_OUTCOME_UNKNOWN",
            action: "Do not retry order creation automatically. Reconcile the operation first.",
          },
          { status: 202 },
        );
      }

      return NextResponse.json(
        {
          error: "PayPal order result could not be confirmed.",
          code: "PAYPAL_ORDER_OUTCOME_UNKNOWN",
          action: "Do not retry order creation automatically. Reconcile the operation first.",
        },
        { status: 202 },
      );
    }

    const approvalLink = order.links?.find(
      (link) => link.rel === "approve" || link.rel === "payer-action",
    )?.href;

    if (!approvalLink || !/^https:\/\/.+/i.test(approvalLink)) {
      // The order may exist, but the response is not sufficient to continue.
      try {
        await sql`
          WITH changed AS (
            UPDATE payment_operations
            SET status = 'outcome_unknown',
                paypal_order_id = ${order.id},
                provider_status = ${order.status},
                last_error_code = 'PAYPAL_APPROVAL_LINK_MISSING',
                version = version + 1,
                updated_at = NOW()
            WHERE id = ${id}::uuid
              AND status = 'request_in_flight'
            RETURNING id, version
          )
          INSERT INTO payment_events (
            operation_id, sequence_no, event_type,
            from_status, to_status, source, metadata
          )
          SELECT
            id, version + 1, 'provider_outcome_unknown',
            'request_in_flight', 'outcome_unknown', 'paypal',
            jsonb_build_object(
              'paypalOrderId', ${order.id},
              'providerStatus', ${order.status},
              'reason', 'approval_link_missing'
            )
          FROM changed
        `;
      } catch {
        // The existing in-flight status still prevents a second submission.
      }

      return NextResponse.json(
        {
          error: "PayPal returned an order without a usable approval link.",
          code: "PAYPAL_APPROVAL_LINK_MISSING",
          paypalOrderId: order.id,
          action: "Reconcile this operation before taking further action.",
        },
        { status: 202 },
      );
    }

    // Persist the provider result and audit event together.
    const saved = await sql`
      WITH changed AS (
        UPDATE payment_operations
        SET status = 'awaiting_approval',
            paypal_order_id = ${order.id},
            provider_status = ${order.status},
            last_error_code = NULL,
            version = version + 1,
            updated_at = NOW()
        WHERE id = ${id}::uuid
          AND status = 'request_in_flight'
          AND paypal_request_id = ${String(claimed[0].paypal_request_id)}
        RETURNING id, status, version, paypal_order_id, provider_status
      ),
      inserted AS (
        INSERT INTO payment_events (
          operation_id, sequence_no, event_type,
          from_status, to_status, source, metadata
        )
        SELECT
          id, version + 1, 'provider_order_created',
          'request_in_flight', 'awaiting_approval', 'paypal',
          jsonb_build_object(
            'paypalOrderId', paypal_order_id,
            'providerStatus', provider_status,
            'approvalUrl', ${approvalLink}::text
          )
        FROM changed
        RETURNING operation_id
      )
      SELECT changed.*
      FROM changed
      INNER JOIN inserted ON inserted.operation_id = changed.id
    `;

    if (saved.length === 0) {
      return NextResponse.json(
        {
          error: "PayPal created an order, but CaptureGuard could not confirm that the result was saved.",
          code: "PROVIDER_RESULT_PERSISTENCE_UNCERTAIN",
          paypalOrderId: order.id,
          action: "Do not create another order. Reconcile this operation.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json({
      ok: true,
      operation: {
        id: saved[0].id,
        status: saved[0].status,
        paypalOrderId: saved[0].paypal_order_id,
        providerStatus: saved[0].provider_status,
      },
      approvalUrl: approvalLink,
      replayed: false,
      sandbox: true,
    });
  } catch (error) {
    console.error("PayPal order endpoint failed:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { error: "Could not process the PayPal order request." },
      { status: 503 },
    );
  }
}
