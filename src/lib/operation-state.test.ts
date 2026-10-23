import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canSubmitPayment,
  transitionOperation,
  type Operation,
} from "./operation-state";

function makeOperation(status: Operation["status"] = "created"): Operation {
  return {
    id: "op_test_001",
    idempotencyKey: "cg_test_001",
    status,
  };
}

describe("CaptureGuard operation state machine", () => {
  it("starts a payment only from a new operation", () => {
    assert.equal(canSubmitPayment(makeOperation("created")), true);
    assert.equal(canSubmitPayment(makeOperation("request_in_flight")), false);
    assert.equal(canSubmitPayment(makeOperation("outcome_unknown")), false);
    assert.equal(canSubmitPayment(makeOperation("succeeded")), false);
  });

  it("records a timeout as an unknown outcome", () => {
    const result = transitionOperation(
      makeOperation("request_in_flight"),
      "request_timed_out",
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.operation.status, "outcome_unknown");
    }
  });

  it("allows provider-confirmed success after a timeout", () => {
    const result = transitionOperation(
      makeOperation("outcome_unknown"),
      "provider_confirms_success",
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.operation.status, "succeeded");
    }
  });

  it("does not allow a blind retry from an unknown outcome", () => {
    const result = transitionOperation(
      makeOperation("outcome_unknown"),
      "request_started",
    );

    assert.equal(result.ok, false);
  });

  it("does not allow a terminal success to be reopened", () => {
    const result = transitionOperation(
      makeOperation("succeeded"),
      "request_started",
    );

    assert.equal(result.ok, false);
  });

  it("preserves the operation ID and idempotency key", () => {
    const original = makeOperation("request_in_flight");
    const result = transitionOperation(original, "request_timed_out");

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.operation.id, original.id);
      assert.equal(result.operation.idempotencyKey, original.idempotencyKey);
    }
  });
});
