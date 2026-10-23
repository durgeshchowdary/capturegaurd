import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { POST } from "./route";

const validUuid = "550e8400-e29b-41d4-a716-446655440000";
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

function makeRequest(
  url: string,
  headers: Record<string, string>,
  method = "POST",
): Request {
  return new Request(url, {
    method,
    headers,
  });
}

describe("checkout-dashboard route", () => {
  it("rejects missing operator authorization", async () => {
    process.env.CAPTUREGUARD_OPERATOR_TOKEN = "operator-secret";
    process.env.CAPTUREGUARD_INTERNAL_TOKEN = "internal-secret";
    process.env.CAPTUREGUARD_PUBLIC_URL = "https://example.com";

    const request = makeRequest(
      "https://example.com/api/operations/550e8400-e29b-41d4-a716-446655440000/checkout-dashboard",
      {
        origin: "https://example.com",
      },
    );

    const response = await POST(request, {
      params: Promise.resolve({ id: validUuid }),
    });

    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error, "Operator authorization failed.");
  });

  it("rejects unexpected origins for state-changing requests", async () => {
    process.env.CAPTUREGUARD_OPERATOR_TOKEN = "operator-secret";
    process.env.CAPTUREGUARD_INTERNAL_TOKEN = "internal-secret";
    process.env.CAPTUREGUARD_PUBLIC_URL = "https://example.com";

    const request = makeRequest(
      "https://example.com/api/operations/550e8400-e29b-41d4-a716-446655440000/checkout-dashboard",
      {
        origin: "https://evil.example",
        "x-captureguard-operator-token": "operator-secret",
      },
    );

    const response = await POST(request, {
      params: Promise.resolve({ id: validUuid }),
    });

    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, "Request origin is not allowed.");
  });

  it("rejects invalid operation IDs", async () => {
    process.env.CAPTUREGUARD_OPERATOR_TOKEN = "operator-secret";
    process.env.CAPTUREGUARD_INTERNAL_TOKEN = "internal-secret";
    process.env.CAPTUREGUARD_PUBLIC_URL = "https://example.com";

    const request = makeRequest(
      "https://example.com/api/operations/not-a-uuid/checkout-dashboard",
      {
        origin: "https://example.com",
        "x-captureguard-operator-token": "operator-secret",
      },
    );

    const response = await POST(request, {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, "Invalid operation ID.");
  });

  it("allows eligible operations to request a PayPal approval link", async () => {
    process.env.CAPTUREGUARD_OPERATOR_TOKEN = "operator-secret";
    process.env.CAPTUREGUARD_INTERNAL_TOKEN = "internal-secret";
    process.env.CAPTUREGUARD_PUBLIC_URL = "https://example.com";

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          ok: true,
          approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ABC123",
          operation: { id: validUuid, status: "awaiting_approval" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );

    const request = makeRequest(
      `https://example.com/api/operations/${validUuid}/checkout-dashboard`,
      {
        origin: "https://example.com",
        "x-captureguard-operator-token": "operator-secret",
      },
    );

    const response = await POST(request, {
      params: Promise.resolve({ id: validUuid }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(
      body.approvalUrl,
      "https://www.sandbox.paypal.com/checkoutnow?token=ABC123",
    );
  });

  it("forwards ineligible operation conflicts without creating a new order", async () => {
    process.env.CAPTUREGUARD_OPERATOR_TOKEN = "operator-secret";
    process.env.CAPTUREGUARD_INTERNAL_TOKEN = "internal-secret";
    process.env.CAPTUREGUARD_PUBLIC_URL = "https://example.com";

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: "This operation cannot create another PayPal order.",
          code: "PAYPAL_ORDER_EXISTS",
          action: "Inspect the existing operation and reconcile its provider state before proceeding.",
          operation: { id: validUuid, status: "awaiting_approval" },
        }),
        {
          status: 409,
          headers: { "content-type": "application/json" },
        },
      );

    const request = makeRequest(
      `https://example.com/api/operations/${validUuid}/checkout-dashboard`,
      {
        origin: "https://example.com",
        "x-captureguard-operator-token": "operator-secret",
      },
    );

    const response = await POST(request, {
      params: Promise.resolve({ id: validUuid }),
    });

    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "This operation cannot create another PayPal order.");
  });

  it("fails safely without a configured public URL", async () => {
    process.env.CAPTUREGUARD_OPERATOR_TOKEN = "operator-secret";
    process.env.CAPTUREGUARD_INTERNAL_TOKEN = "internal-secret";
    delete process.env.CAPTUREGUARD_PUBLIC_URL;

    const request = makeRequest(
      `https://example.com/api/operations/${validUuid}/checkout-dashboard`,
      {
        origin: "https://example.com",
        "x-captureguard-operator-token": "operator-secret",
      },
    );

    const response = await POST(request, {
      params: Promise.resolve({ id: validUuid }),
    });

    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(
      body.error,
      "Public URL configuration is missing or invalid. Cannot initiate checkout.",
    );
  });
});
