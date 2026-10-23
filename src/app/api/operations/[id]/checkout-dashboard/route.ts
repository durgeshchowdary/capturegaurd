import { NextResponse } from "next/server";
import { matchesToken, isValidUUID, validateOrigin } from "@/lib/auth";
import { validatePayPalApprovalUrl, validatePublicUrl } from "@/lib/paypal-url";

/**
 * POST /api/operations/[id]/checkout-dashboard
 *
 * Operator-authorized endpoint that initiates PayPal Sandbox checkout
 * for an eligible operation. This is the dashboard-facing gateway that
 * proxies to the internal paypal-order endpoint.
 *
 * Security:
 * - Requires the operator token via x-captureguard-operator-token header.
 * - Validates same-origin requests via Origin header check.
 * - Never exposes internal tokens, PayPal credentials, or server env vars.
 * - Returns generic client-facing errors with sanitized diagnostics.
 *
 * Authorization model limitations:
 * The operator token is a shared secret held in browser memory. This is
 * NOT equivalent to enterprise-grade user authentication. If the browser
 * is compromised via XSS, the in-memory token can be exfiltrated. This
 * design is appropriate for a developer sandbox tool; production deployments
 * should use a session-based auth mechanism with HttpOnly cookies.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  // ── Method guard (belt-and-suspenders; Next.js routes by method) ────
  if (request.method !== "POST") {
    return NextResponse.json(
      { error: "Method not allowed." },
      { status: 405 },
    );
  }

  // ── Origin validation (CSRF protection) ────────────────────────────
  if (!validateOrigin(request)) {
    return NextResponse.json(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  }

  // ── Operator authorization ────────────────────────────────────────
  const operatorToken = process.env.CAPTUREGUARD_OPERATOR_TOKEN;
  const internalToken = process.env.CAPTUREGUARD_INTERNAL_TOKEN;

  if (!operatorToken || !internalToken) {
    return NextResponse.json(
      { error: "Dashboard operator access is not configured." },
      { status: 503 },
    );
  }

  const suppliedToken = request.headers.get("x-captureguard-operator-token");

  if (!matchesToken(operatorToken, suppliedToken)) {
    return NextResponse.json(
      { error: "Operator authorization failed." },
      { status: 401 },
    );
  }

  // ── Operation ID validation ────────────────────────────────────────
  const { id } = await context.params;

  if (!isValidUUID(id)) {
    return NextResponse.json(
      { error: "Invalid operation ID." },
      { status: 400 },
    );
  }

  // ── Public URL configuration check ────────────────────────────────
  // The internal paypal-order route uses CAPTUREGUARD_PUBLIC_URL for
  // return/cancel URLs. Validate it before making the provider request.
  const publicUrl = validatePublicUrl(process.env.CAPTUREGUARD_PUBLIC_URL);
  if (!publicUrl) {
    console.error(
      "[CaptureGuard] CAPTUREGUARD_PUBLIC_URL is missing or invalid. " +
        "Cannot create PayPal orders without a valid public URL for return/cancel redirects.",
    );
    return NextResponse.json(
      { error: "Public URL configuration is missing or invalid. Cannot initiate checkout." },
      { status: 503 },
    );
  }

  // ── Request size guard (no body expected) ─────────────────────────
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 1024) {
    return NextResponse.json(
      { error: "Request body exceeds expected size." },
      { status: 413 },
    );
  }

  // ── Delegate to the internal paypal-order endpoint ────────────────
  const baseUrl = new URL(request.url);
  const target = new URL(
    `/api/operations/${encodeURIComponent(id)}/paypal-order`,
    baseUrl.origin,
  );

  let result: Response;
  try {
    result = await fetch(target, {
      method: "POST",
      headers: {
        authorization: `Bearer ${internalToken}`,
        "content-type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    return NextResponse.json(
      {
        error: "Could not reach the order creation handler. No order has been confirmed.",
        code: "CHECKOUT_INITIATION_UNAVAILABLE",
      },
      { status: 502 },
    );
  }

  // ── Parse the internal response ───────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = (await result.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      {
        error: "The order creation handler returned an unparseable response.",
        code: "CHECKOUT_RESPONSE_INVALID",
      },
      { status: 502 },
    );
  }

  // ── Handle non-success: pass through status but sanitize body ─────
  if (!result.ok || body.ok !== true) {
    // HTTP 202 from the internal endpoint means uncertain outcome.
    const clientStatus = result.status === 202 ? 202 : result.status;

    return NextResponse.json(
      {
        error:
          typeof body.error === "string"
            ? body.error
            : "PayPal order creation did not succeed.",
        code: typeof body.code === "string" ? body.code : "CHECKOUT_FAILED",
        action: typeof body.action === "string" ? body.action : undefined,
        // Pass through operation metadata (non-sensitive).
        operation:
          body.operation && typeof body.operation === "object"
            ? body.operation
            : undefined,
      },
      { status: clientStatus },
    );
  }

  // ── Validate the approval URL before returning it to the browser ──
  const rawApprovalUrl =
    typeof body.approvalUrl === "string" ? body.approvalUrl : null;

  const validatedApprovalUrl = validatePayPalApprovalUrl(rawApprovalUrl);

  if (!validatedApprovalUrl) {
    // The order may exist at PayPal, but the approval URL is not safe
    // to redirect to. Do not return a fallback URL.
    return NextResponse.json(
      {
        error:
          "PayPal created an order but the approval URL failed validation. " +
          "Reconcile this operation before proceeding.",
        code: "APPROVAL_URL_VALIDATION_FAILED",
        operation:
          body.operation && typeof body.operation === "object"
            ? body.operation
            : undefined,
      },
      { status: 502 },
    );
  }

  // ── Success: return the validated approval URL ────────────────────
  return NextResponse.json({
    ok: true,
    approvalUrl: validatedApprovalUrl,
    operation:
      body.operation && typeof body.operation === "object"
        ? body.operation
        : undefined,
    sandbox: true,
  });
}
