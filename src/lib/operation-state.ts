export type OperationStatus =
  | "created"
  | "request_in_flight"
  | "awaiting_approval"
  | "outcome_unknown"
  | "reconciliation_required"
  | "succeeded"
  | "failed";

export type OperationEvent =
  | "request_started"
  | "provider_confirmed_success"
  | "provider_confirmed_failure"
  | "request_timed_out"
  | "provider_state_unresolved"
  | "provider_confirms_success"
  | "provider_confirms_failure"
  | "provider_order_created";

export type Operation = {
  id: string;
  idempotencyKey: string;
  status: OperationStatus;
};

export type TransitionResult =
  | { ok: true; operation: Operation }
  | { ok: false; reason: string };

const transitions: Record<
  OperationStatus,
  Partial<Record<OperationEvent, OperationStatus>>
> = {
  created: {
    request_started: "request_in_flight",
  },
  request_in_flight: {
    provider_order_created: "awaiting_approval",
    provider_confirmed_success: "succeeded",
    provider_confirmed_failure: "failed",
    request_timed_out: "outcome_unknown",
  },
  awaiting_approval: {},
  outcome_unknown: {
    provider_state_unresolved: "reconciliation_required",
    provider_confirms_success: "succeeded",
    provider_confirms_failure: "failed",
  },
  reconciliation_required: {
    provider_confirms_success: "succeeded",
    provider_confirms_failure: "failed",
  },
  succeeded: {},
  failed: {},
};

export function transitionOperation(
  operation: Operation,
  event: OperationEvent,
): TransitionResult {
  const nextStatus = transitions[operation.status][event];

  if (!nextStatus) {
    return {
      ok: false,
      reason: `Event "${event}" is not allowed from status "${operation.status}".`,
    };
  }

  return {
    ok: true,
    operation: {
      ...operation,
      status: nextStatus,
    },
  };
}

export function canSubmitPayment(operation: Operation): boolean {
  return operation.status === "created";
}
