import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchesToken, isValidUUID, validateOrigin } from "./auth";

describe("matchesToken", () => {
  it("returns true for matching tokens", () => {
    assert.equal(matchesToken("secret123", "secret123"), true);
  });

  it("returns false for mismatched tokens", () => {
    assert.equal(matchesToken("secret123", "wrong"), false);
  });

  it("returns false when expected is undefined", () => {
    assert.equal(matchesToken(undefined, "secret123"), false);
  });

  it("returns false when supplied is null", () => {
    assert.equal(matchesToken("secret123", null), false);
  });

  it("returns false when both are empty", () => {
    assert.equal(matchesToken("", ""), false);
  });

  it("returns false for different-length tokens (timing-safe)", () => {
    assert.equal(matchesToken("short", "much-longer-token"), false);
  });
});

describe("isValidUUID", () => {
  it("accepts a valid UUID v4", () => {
    assert.equal(isValidUUID("550e8400-e29b-41d4-a716-446655440000"), true);
  });

  it("accepts a valid UUID v7", () => {
    assert.equal(isValidUUID("01929f7e-1234-7abc-89ab-abcdef012345"), true);
  });

  it("rejects a non-UUID string", () => {
    assert.equal(isValidUUID("not-a-uuid"), false);
  });

  it("rejects an empty string", () => {
    assert.equal(isValidUUID(""), false);
  });

  it("rejects SQL injection attempt", () => {
    assert.equal(
      isValidUUID("550e8400-e29b-41d4-a716-446655440000'; DROP TABLE--"),
      false,
    );
  });
});

describe("validateOrigin", () => {
  it("allows GET requests regardless of origin", () => {
    const req = new Request("https://example.com/api/test", {
      method: "GET",
      headers: { origin: "https://evil.com" },
    });
    assert.equal(validateOrigin(req), true);
  });

  it("allows POST with matching origin", () => {
    const req = new Request("https://example.com/api/test", {
      method: "POST",
      headers: { origin: "https://example.com" },
    });
    assert.equal(validateOrigin(req), true);
  });

  it("rejects POST with mismatched origin", () => {
    const req = new Request("https://example.com/api/test", {
      method: "POST",
      headers: { origin: "https://evil.com" },
    });
    assert.equal(validateOrigin(req), false);
  });

  it("allows POST without origin header (same-origin fetch)", () => {
    const req = new Request("https://example.com/api/test", {
      method: "POST",
    });
    assert.equal(validateOrigin(req), true);
  });

  it("rejects POST with malformed origin", () => {
    const req = new Request("https://example.com/api/test", {
      method: "POST",
      headers: { origin: "not-a-url" },
    });
    assert.equal(validateOrigin(req), false);
  });
});
