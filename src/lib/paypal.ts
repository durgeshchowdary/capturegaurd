const PAYPAL_SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

type PayPalTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  app_id?: string;
};

type PayPalOrderResponse = {
  id?: string;
  status?: string;
  links?: Array<{ rel?: string; href?: string; method?: string }>;
};

export class PayPalError extends Error {
  constructor(
    message: string,
    public readonly providerStatus?: number,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

export async function getPayPalAccessToken(): Promise<{
  accessToken: string;
  expiresIn: number;
  appId: string | null;
}> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new PayPalError("PayPal Sandbox credentials are not configured.");
  }

  let response: Response;

  try {
    response = await fetch(`${PAYPAL_SANDBOX_BASE_URL}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new PayPalError("Could not reach PayPal Sandbox authentication.");
  }

  if (!response.ok) {
    throw new PayPalError(
      response.status === 401
        ? "PayPal rejected the Sandbox credentials."
        : "PayPal Sandbox authentication failed.",
      response.status,
    );
  }

  let token: PayPalTokenResponse;

  try {
    token = (await response.json()) as PayPalTokenResponse;
  } catch {
    throw new PayPalError("PayPal returned an invalid authentication response.");
  }

  if (
    typeof token.access_token !== "string" ||
    token.access_token.length === 0 ||
    typeof token.expires_in !== "number"
  ) {
    throw new PayPalError("PayPal authentication response was incomplete.");
  }

  return {
    accessToken: token.access_token,
    expiresIn: token.expires_in,
    appId: token.app_id ?? null,
  };
}

export async function createPayPalOrder(input: {
  accessToken: string;
  requestId: string;
  operationId: string;
  amountMinor: number;
  currency: string;
}): Promise<PayPalOrderResponse> {
  // Validate CAPTUREGUARD_PUBLIC_URL before making the provider request.
  // This import is inline-style to keep changes minimal; the module is
  // a pure validation function with no side effects.
  const { validatePublicUrl } = await import("@/lib/paypal-url");
  const publicUrl = validatePublicUrl(process.env.CAPTUREGUARD_PUBLIC_URL);
  if (!publicUrl) {
    throw new PayPalError(
      "CAPTUREGUARD_PUBLIC_URL is missing or invalid. Cannot create PayPal orders.",
    );
  }

  let response: Response;

  try {
    response = await fetch(`${PAYPAL_SANDBOX_BASE_URL}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
        "PayPal-Request-Id": input.requestId,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        payment_source: {
          paypal: {
            experience_context: {
              return_url: `${publicUrl}/checkout/return`,
              cancel_url: `${publicUrl}/checkout/cancel`,
              user_action: "PAY_NOW",
            },
          },
        },
        purchase_units: [
          {
            reference_id: input.operationId,
            amount: {
              currency_code: input.currency,
              value: (input.amountMinor / 100).toFixed(2),
            },
          },
        ],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // The request may have reached PayPal. The caller must treat this as unknown.
    throw new PayPalError(
      "PayPal order creation has an uncertain outcome.",
    );
  }

  if (!response.ok) {
    // Keep the result uncertain, but preserve sanitized provider diagnostics.
    let providerDetails: {
      name?: string;
      message?: string;
      debug_id?: string;
      details?: Array<{ issue?: string }>;
    } = {};

    try {
      const body = await response.json();
      if (body && typeof body === "object") {
        providerDetails = {
          name: typeof body.name === "string" ? body.name : undefined,
          message: typeof body.message === "string" ? body.message : undefined,
          debug_id: typeof body.debug_id === "string" ? body.debug_id : undefined,
          details: Array.isArray(body.details)
            ? body.details
                .filter((item: unknown) => item && typeof item === "object")
                .map((item: { issue?: unknown }) => ({
                  issue: typeof item.issue === "string" ? item.issue : undefined,
                }))
            : undefined,
        };
      }
    } catch {
      // Some provider errors do not include a JSON body.
    }

    throw new PayPalError(
      `PayPal order request rejected (HTTP ${response.status}): ${JSON.stringify(providerDetails)}`,
      response.status,
    );
  }

  try {
    const order = (await response.json()) as PayPalOrderResponse;

    if (
      typeof order.id !== "string" ||
      typeof order.status !== "string" ||
      !Array.isArray(order.links)
    ) {
      throw new Error("Incomplete order response");
    }

    return order;
  } catch {
    // A successful HTTP response with an unusable body is still ambiguous.
    throw new PayPalError(
      "PayPal returned an incomplete order response.",
      response.status,
    );
  }
}

export async function getPayPalOrder(orderId: string) {
  const { accessToken } = await getPayPalAccessToken();
  let response: Response;

  try {
    response = await fetch(
      `${PAYPAL_SANDBOX_BASE_URL}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );
  } catch {
    throw new PayPalError(
      "Could not retrieve the PayPal order. Its current state is unknown.",
    );
  }

  if (!response.ok) {
    throw new PayPalError(
      "PayPal could not retrieve the requested order.",
      response.status,
    );
  }

  return response.json();
}

export type PayPalCaptureResponse = {
  id?: string;
  status?: string;
  purchase_units?: Array<{
    payments?: {
      captures?: Array<{
        id?: string;
        status?: string;
        amount?: {
          currency_code?: string;
          value?: string;
        };
      }>;
    };
  }>;
};

export async function capturePayPalOrder(input: {
  accessToken: string;
  orderId: string;
  requestId: string;
}): Promise<PayPalCaptureResponse> {
  let response: Response;

  try {
    response = await fetch(
      `${PAYPAL_SANDBOX_BASE_URL}/v2/checkout/orders/${encodeURIComponent(input.orderId)}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          Prefer: "return=representation",
          "PayPal-Request-Id": input.requestId,
        },
        body: JSON.stringify({}),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );
  } catch {
    throw new PayPalError(
      "PayPal capture outcome is uncertain; reconcile before any retry.",
    );
  }

  if (!response.ok) {
    throw new PayPalError(
      "PayPal did not confirm the capture result.",
      response.status,
    );
  }

  try {
    const result = (await response.json()) as PayPalCaptureResponse;

    if (
      typeof result.status !== "string" ||
      !Array.isArray(result.purchase_units)
    ) {
      throw new Error("Incomplete capture response");
    }

    return result;
  } catch {
    throw new PayPalError(
      "PayPal returned an incomplete capture response.",
      response.status,
    );
  }
}




