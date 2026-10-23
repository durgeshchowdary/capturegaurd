import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validatePayPalApprovalUrl,
  validatePublicUrl,
} from "./paypal-url";

describe("validatePayPalApprovalUrl", () => {
  it("accepts a valid PayPal Sandbox approval URL (www)", () => {
    const url =
      "https://www.sandbox.paypal.com/checkoutnow?token=1AB23456CD789012E";
    assert.equal(validatePayPalApprovalUrl(url), url);
  });

  it("accepts a valid PayPal Sandbox approval URL (no www)", () => {
    const url =
      "https://sandbox.paypal.com/checkoutnow?token=1AB23456CD789012E";
    assert.equal(validatePayPalApprovalUrl(url), url);
  });

  it("rejects an HTTP URL", () => {
    const url =
      "http://www.sandbox.paypal.com/checkoutnow?token=1AB23456CD789012E";
    assert.equal(validatePayPalApprovalUrl(url), null);
  });

  it("rejects a production PayPal URL", () => {
    const url = "https://www.paypal.com/checkoutnow?token=1AB23456CD789012E";
    assert.equal(validatePayPalApprovalUrl(url), null);
  });

  it("rejects a lookalike domain (suffix match)", () => {
    assert.equal(
      validatePayPalApprovalUrl(
        "https://evil.sandbox.paypal.com/checkoutnow?token=X",
      ),
      null,
    );
  });

  it("rejects a lookalike domain (prefix match)", () => {
    assert.equal(
      validatePayPalApprovalUrl(
        "https://www.sandbox.paypal.com.evil.com/checkoutnow?token=X",
      ),
      null,
    );
  });

  it("rejects an arbitrary HTTPS URL", () => {
    assert.equal(
      validatePayPalApprovalUrl("https://evil.example.com/steal?token=X"),
      null,
    );
  });

  it("rejects URLs with embedded credentials (userinfo)", () => {
    assert.equal(
      validatePayPalApprovalUrl(
        "https://admin:secret@www.sandbox.paypal.com/checkoutnow?token=X",
      ),
      null,
    );
  });

  it("rejects null and undefined", () => {
    assert.equal(validatePayPalApprovalUrl(null), null);
    assert.equal(validatePayPalApprovalUrl(undefined), null);
  });

  it("rejects empty string", () => {
    assert.equal(validatePayPalApprovalUrl(""), null);
  });

  it("rejects malformed URL", () => {
    assert.equal(validatePayPalApprovalUrl("not-a-url"), null);
  });

  it("rejects javascript: protocol", () => {
    assert.equal(
      validatePayPalApprovalUrl("javascript:alert(1)"),
      null,
    );
  });

  it("rejects data: URL", () => {
    assert.equal(
      validatePayPalApprovalUrl("data:text/html,<h1>owned</h1>"),
      null,
    );
  });
});

describe("validatePublicUrl", () => {
  it("accepts an HTTPS URL", () => {
    assert.equal(
      validatePublicUrl("https://captureguard.example.com"),
      "https://captureguard.example.com",
    );
  });

  it("accepts localhost HTTP for development", () => {
    assert.equal(
      validatePublicUrl("http://localhost:3000"),
      "http://localhost:3000",
    );
  });

  it("accepts 127.0.0.1 HTTP for development", () => {
    assert.equal(
      validatePublicUrl("http://127.0.0.1:3000"),
      "http://127.0.0.1:3000",
    );
  });

  it("rejects non-localhost HTTP URLs", () => {
    assert.equal(
      validatePublicUrl("http://captureguard.example.com"),
      null,
    );
  });

  it("strips trailing slash", () => {
    assert.equal(
      validatePublicUrl("https://captureguard.example.com/"),
      "https://captureguard.example.com",
    );
  });

  it("rejects missing URL", () => {
    assert.equal(validatePublicUrl(undefined), null);
    assert.equal(validatePublicUrl(""), null);
  });

  it("rejects malformed URL", () => {
    assert.equal(validatePublicUrl("not-a-url"), null);
  });

  it("rejects URLs with embedded credentials", () => {
    assert.equal(
      validatePublicUrl("https://admin:pass@example.com"),
      null,
    );
  });
});
