import { NextResponse } from "next/server";
import { getPayPalAccessToken, PayPalError } from "@/lib/paypal";

export async function GET() {
  if (
    !process.env.PAYPAL_CLIENT_ID ||
    !process.env.PAYPAL_CLIENT_SECRET
  ) {
    return NextResponse.json(
      {
        ok: false,
        provider: "paypal-sandbox",
        error: "Sandbox credentials are not configured.",
      },
      { status: 503 },
    );
  }

  try {
    const result = await getPayPalAccessToken();

    return NextResponse.json({
      ok: true,
      provider: "paypal-sandbox",
      authenticated: true,
      expiresIn: result.expiresIn,
      appId: result.appId,
    });
  } catch (error) {
    if (error instanceof PayPalError) {
      const status = error.providerStatus === 401 ? 502 : 503;

      return NextResponse.json(
        {
          ok: false,
          provider: "paypal-sandbox",
          authenticated: false,
          error: error.message,
          ...(error.providerStatus
            ? { providerStatus: error.providerStatus }
            : {}),
        },
        { status },
      );
    }

    console.error("PayPal Sandbox health check failed.");

    return NextResponse.json(
      {
        ok: false,
        provider: "paypal-sandbox",
        error: "Unexpected PayPal connection error.",
      },
      { status: 503 },
    );
  }
}
