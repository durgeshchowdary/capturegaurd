import { NextResponse } from "next/server";
import { isValidUUID, matchesToken, validateOrigin } from "@/lib/auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (request.method !== "POST") {
    return NextResponse.json(
      { error: "Method not allowed." },
      { status: 405 },
    );
  }

  if (!validateOrigin(request)) {
    return NextResponse.json(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  }

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

  const { id } = await context.params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: "Invalid operation ID." }, { status: 400 });
  }

  const baseUrl = new URL(request.url);
  const target = new URL(
    `/api/operations/${encodeURIComponent(id)}/reconcile`,
    baseUrl.origin,
  );

  try {
    const result = await fetch(target, {
      method: "POST",
      headers: {
        authorization: `Bearer ${internalToken}`,
        "content-type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
    });

    const body = await result.json();
    return NextResponse.json(body, { status: result.status });
  } catch {
    return NextResponse.json(
      { error: "Could not reach the reconciliation handler. No success is assumed." },
      { status: 502 },
    );
  }
}
