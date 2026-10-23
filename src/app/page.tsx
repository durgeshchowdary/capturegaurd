"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ApiEvent = {
  sequence: number;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  source: string;
  occurredAt: string;
};

type ApiOperation = {
  id: string;
  idempotencyKey: string;
  amountMinor: number | string;
  currency: string;
  status: string;
  version: number;
  paypalOrderId: string | null;
  providerStatus: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
  events: ApiEvent[];
};

type Filter = "All" | "Needs attention" | "Awaiting approval" | "In progress" | "Succeeded" | "Failed";

const filters: Filter[] = [
  "All",
  "Needs attention",
  "Awaiting approval",
  "In progress",
  "Succeeded",
  "Failed",
];

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    created: "Created",
    request_in_flight: "In flight",
    awaiting_approval: "Awaiting approval",
    outcome_unknown: "Outcome unknown",
    reconciliation_required: "Needs reconciliation",
    succeeded: "Succeeded",
    failed: "Failed",
  };
  return labels[status] ?? status.replaceAll("_", " ");
}

function statusClass(status: string): string {
  if (status === "succeeded") return "succeeded";
  if (status === "failed") return "failed";
  if (status === "outcome_unknown" || status === "reconciliation_required") return "uncertain";
  return "processing";
}

function isAttention(status: string): boolean {
  return status === "outcome_unknown" || status === "reconciliation_required";
}

function isInProgress(status: string): boolean {
  return status === "created" || status === "request_in_flight";
}

function formatAmount(amountMinor: number | string, currency: string): string {
  const amount = Number(amountMinor) / 100;
  if (!Number.isFinite(amount)) return `${amountMinor} ${currency}`;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function relativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

function eventTitle(type: string): string {
  const labels: Record<string, string> = {
    operation_created: "Operation created",
    provider_request_started: "Provider request started",
    provider_timeout: "Provider request timed out",
    provider_order_created: "PayPal order created",
    provider_confirmed_success: "Provider confirmed success",
    provider_confirmed_failure: "Provider confirmed failure",
    provider_state_unresolved: "Provider state unresolved",
    provider_confirms_success: "Provider confirms success",
    provider_confirms_failure: "Provider confirms failure",
    reconciliation_started: "Reconciliation started",
    request_timed_out: "Request timed out",
  };
  return labels[type] ?? type.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

function eventDetail(event: ApiEvent): string {
  if (event.type === "provider_timeout") {
    return "The response timed out. This does not prove the payment failed; check provider state before retrying.";
  }
  if (event.type === "provider_order_created") {
    return "PayPal created an order. Order creation alone does not mean the payment was captured.";
  }
  if (event.type === "reconciliation_started") {
    return "A reconciliation check was requested. Verify provider state before taking another payment action.";
  }
  if (event.toStatus) {
    return `Recorded state transition${event.fromStatus ? ` from ${statusLabel(event.fromStatus)}` : ""} to ${statusLabel(event.toStatus)}.`;
  }
  return `Recorded by ${event.source}.`;
}

function eventState(type: string, toStatus: string | null): string {
  if (
    type.includes("timeout") ||
    type.includes("unresolved") ||
    toStatus === "outcome_unknown" ||
    toStatus === "reconciliation_required"
  ) return "warn";
  if (toStatus === "failed") return "warn";
  if (toStatus === "succeeded" || type === "provider_order_created") return "done";
  return "pending";
}

export default function Home() {
  const [operations, setOperations] = useState<ApiOperation[]>([]);
  const [filter, setFilter] = useState<Filter>("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // ── Operator authorization ────────────────────────────────────────
  // The operator token is held in component memory ONLY.
  // It is never persisted to localStorage, sessionStorage, cookies, or URLs.
  //
  // SECURITY LIMITATION: This is a shared-secret model. If the browser
  // is compromised via XSS, the in-memory token can be exfiltrated.
  // This is acceptable for a developer sandbox tool but is NOT
  // enterprise-grade user authentication.
  const [operatorToken, setOperatorToken] = useState("");
  const [operatorAuthorized, setOperatorAuthorized] = useState(false);
  const [showTokenInput, setShowTokenInput] = useState(false);

  // ── Checkout initiation state ─────────────────────────────────────
  const [checkoutInFlight, setCheckoutInFlight] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const checkoutAbort = useRef<AbortController | null>(null);

  const loadOperations = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);

    try {
      const response = await fetch("/api/operations/list", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok || data.ok !== true || !Array.isArray(data.operations)) {
        throw new Error(data.error || "Could not load operations from the database.");
      }

      setOperations(data.operations as ApiOperation[]);
      setLastUpdated(new Date().toISOString());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load operations.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // ── Checkout initiation handler ───────────────────────────────────
  const startCheckout = useCallback(async (operationId: string) => {
    if (checkoutInFlight || !operatorToken) return;

    // Abort any previous in-flight request.
    checkoutAbort.current?.abort();
    const controller = new AbortController();
    checkoutAbort.current = controller;

    setCheckoutInFlight(true);
    setCheckoutError(null);

    try {
      const response = await fetch(
        `/api/operations/${encodeURIComponent(operationId)}/checkout-dashboard`,
        {
          method: "POST",
          headers: {
            "x-captureguard-operator-token": operatorToken,
            "content-type": "application/json",
          },
          cache: "no-store",
          signal: controller.signal,
        },
      );

      const data = await response.json();

      if (controller.signal.aborted) return;

      // HTTP 202 = uncertain outcome. Do NOT treat as success.
      if (response.status === 202) {
        setCheckoutError(
          (typeof data.error === "string" ? data.error : "Order creation outcome is uncertain.") +
          " Do not retry automatically — reconcile first.",
        );
        void loadOperations(true);
        return;
      }

      if (response.status === 401) {
        setOperatorAuthorized(false);
        setCheckoutError("Operator authorization failed. Please re-enter your token.");
        return;
      }

      if (!response.ok || data.ok !== true) {
        setCheckoutError(
          typeof data.error === "string"
            ? data.error
            : "Checkout initiation failed.",
        );
        void loadOperations(true);
        return;
      }

      // Validate that we have an approval URL before redirecting.
      if (typeof data.approvalUrl !== "string" || !data.approvalUrl) {
        setCheckoutError(
          "Server returned success but no approval URL. Reconcile the operation.",
        );
        void loadOperations(true);
        return;
      }

      // Redirect to the validated PayPal approval URL.
      window.location.href = data.approvalUrl;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setCheckoutError("Network error during checkout initiation.");
    } finally {
      if (!controller.signal.aborted) {
        setCheckoutInFlight(false);
        checkoutAbort.current = null;
      }
    }
  }, [checkoutInFlight, operatorToken, loadOperations]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOperations();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadOperations]);

  const visible = useMemo(() => operations.filter((op) => {
    if (filter === "All") return true;
    if (filter === "Needs attention") return isAttention(op.status);
    if (filter === "Awaiting approval") return op.status === "awaiting_approval";
    if (filter === "In progress") return isInProgress(op.status);
    if (filter === "Succeeded") return op.status === "succeeded";
    return op.status === "failed";
  }), [operations, filter]);

  const selected = visible.find((op) => op.id === selectedId)
    ?? operations.find((op) => op.id === selectedId)
    ?? visible[0];

  const counts = useMemo(() => ({
    total: operations.length,
    uncertain: operations.filter((op) => isAttention(op.status)).length,
    succeeded: operations.filter((op) => op.status === "succeeded").length,
    processing: operations.filter((op) =>
      isInProgress(op.status) || op.status === "awaiting_approval"
    ).length,
  }), [operations]);

  const sandboxOrders = operations.filter((op) => op.paypalOrderId).length;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview">
          <span className="brand-mark">C</span>
          <span>capture<span className="brand-light">guard</span></span>
        </a>

        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace">
          <span className="workspace-avatar">D</span>
          <span><strong>Developer workspace</strong><small>PayPal Sandbox</small></span>
          <span className="chevron">⌄</span>
        </div>

        <div className="nav-label">MONITOR</div>
        <nav className="nav-list">
          <a className="nav-item active" href="#overview"><span>◫</span> Overview</a>
          <a className="nav-item" href="#operations"><span>↗</span> Operations <span className="nav-count">{counts.total}</span></a>
          <a className="nav-item" href="#timeline"><span>◷</span> Event timeline</a>
        </nav>

        <div className="nav-label">DEVELOPER</div>
        <nav className="nav-list">
          <a className="nav-item" href="#safety"><span>⛨</span> Retry safety</a>
          <a className="nav-item" href="#integration"><span>⌘</span> Integration</a>
        </nav>

        <div className="nav-label">OPERATOR</div>
        <nav className="nav-list">
          {operatorAuthorized ? (
            <div className="nav-item" style={{ color: "var(--lime)" }}>
              <span>✓</span> Authorized
              <button
                className="icon-button"
                style={{ marginLeft: "auto", fontSize: "10px", color: "var(--paper)" }}
                title="Revoke operator token"
                onClick={() => {
                  setOperatorToken("");
                  setOperatorAuthorized(false);
                  setShowTokenInput(false);
                }}
                aria-label="Revoke operator authorization"
              >
                ✕
              </button>
            </div>
          ) : (
            <>
              <button
                className="nav-item"
                onClick={() => setShowTokenInput(!showTokenInput)}
                style={{ width: "100%", textAlign: "left", background: "none", border: "none" }}
                aria-expanded={showTokenInput}
              >
                <span>🔑</span> Authorize
              </button>
              {showTokenInput && (
                <div style={{ padding: "0 8px 8px" }}>
                  <input
                    type="password"
                    placeholder="Operator token"
                    value={operatorToken}
                    onChange={(e) => setOperatorToken(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && operatorToken) {
                        setOperatorAuthorized(true);
                        setShowTokenInput(false);
                      }
                    }}
                    autoComplete="off"
                    aria-label="Operator token"
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      border: "1px solid #64645e",
                      background: "#2a2a2a",
                      color: "var(--paper)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                      marginBottom: "6px",
                    }}
                  />
                  <button
                    onClick={() => {
                      if (operatorToken) {
                        setOperatorAuthorized(true);
                        setShowTokenInput(false);
                      }
                    }}
                    disabled={!operatorToken}
                    style={{
                      width: "100%",
                      padding: "5px",
                      background: operatorToken ? "var(--lime)" : "#333",
                      color: "var(--ink)",
                      border: "1px solid var(--ink)",
                      fontSize: "10px",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      cursor: operatorToken ? "pointer" : "not-allowed",
                    }}
                    aria-label="Confirm operator authorization"
                  >
                    Confirm
                  </button>
                </div>
              )}
            </>
          )}
        </nav>

        <div className="sidebar-bottom">
          <div className="connection"><span className="green-dot" /> Sandbox environment</div>
          <div className="profile">
            <div className="profile-avatar">CG</div>
            <div><strong>CaptureGuard</strong><small>Local development</small></div>
            <span className="chevron">···</span>
          </div>
        </div>
      </aside>

      <section className="main-panel" id="overview">
        <header className="topbar">
          <div className="breadcrumbs">Workspace <span>/</span> <strong>Overview</strong></div>
          <div className="topbar-right">
            <span className="environment"><span className="green-dot" /> SANDBOX</span>
            <button className="icon-button" title="Refresh operations" onClick={() => void loadOperations(true)} disabled={refreshing}>
              {refreshing ? "…" : "↻"}
            </button>
            <div className="profile-avatar small-avatar">CG</div>
          </div>
        </header>

        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">PAYMENT RELIABILITY</div>
              <h1>Payment operations</h1>
              <p className="subtitle">Know what happened before an AI agent tries again.</p>
            </div>
            <span className="demo-tag"><span className="yellow-dot" /> LIVE DATABASE</span>
          </div>

          <div className="notice" id="safety">
            <div className="notice-icon">!</div>
            <div className="notice-copy">
              <strong>Never blindly retry an uncertain payment.</strong>
              <p>A timeout does not prove a payment failed. Reconcile the provider state before attempting another action.</p>
            </div>
            <a href="#operations" className="notice-link">Review operations <span>→</span></a>
          </div>

          {error && (
            <div className="api-error" role="alert">
              <strong>Could not refresh database records.</strong>
              <span>{error}</span>
              <button className="filter-button" onClick={() => void loadOperations(true)}>Try again</button>
            </div>
          )}

          <section className="stats-grid" aria-label="Operation summary">
            <article className="stat-card">
              <div className="stat-top"><span>Total operations</span><span className="stat-icon">↗</span></div>
              <div className="stat-value">{counts.total.toString().padStart(2, "0")}</div>
              <div className="stat-foot">{loading ? "Loading database…" : "Stored in Neon PostgreSQL"}</div>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span>Needs reconciliation</span><span className="stat-icon warning-icon">!</span></div>
              <div className="stat-value">{counts.uncertain.toString().padStart(2, "0")}<span className="stat-unit"> operations</span></div>
              <div className="stat-foot warning-text"><span className="yellow-dot" /> Requires provider-state check</div>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span>Confirmed success</span><span className="stat-icon success-icon">✓</span></div>
              <div className="stat-value">{counts.succeeded.toString().padStart(2, "0")}</div>
              <div className="stat-foot">Only provider-confirmed successes</div>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span>In progress</span><span className="stat-icon">◷</span></div>
              <div className="stat-value">{counts.processing.toString().padStart(2, "0")}</div>
              <div className="stat-foot">Created, in flight or awaiting approval</div>
            </article>
          </section>

          <section className="operations-card" id="operations">
            <div className="section-heading">
              <div><h2>Recent operations</h2><p>Actual operation state and recorded audit events.</p></div>
              <span className="live-label"><span className="green-dot" /> NEON POSTGRESQL</span>
            </div>

            <div className="filter-row" role="group" aria-label="Filter operations">
              {filters.map((item) => (
                <button key={item} onClick={() => setFilter(item)}
                  className={`filter-button ${filter === item ? "filter-active" : ""}`}>
                  {item}
                  {item === "All" && <span className="filter-number">{counts.total}</span>}
                  {item === "Needs attention" && counts.uncertain > 0 && <span className="filter-number">{counts.uncertain}</span>}
                </button>
              ))}
            </div>

            <div className="table-wrap">
              <table>
                <thead><tr><th>OPERATION</th><th>AMOUNT</th><th>STATUS</th><th>LAST ACTIVITY</th><th /></tr></thead>
                <tbody>
                  {visible.map((op) => (
                    <tr key={op.id} onClick={() => setSelectedId(op.id)}
                      className={selected?.id === op.id ? "selected-row" : ""}>
                      <td>
                        <button className="operation-link" onClick={() => setSelectedId(op.id)}>
                          {op.id}
                          <small>{op.paypalOrderId ? `PayPal order ${op.paypalOrderId}` : `Key ${op.idempotencyKey}`}</small>
                        </button>
                      </td>
                      <td className="amount">{formatAmount(op.amountMinor, op.currency)}</td>
                      <td><span className={`status status-${statusClass(op.status)}`}><span />{statusLabel(op.status)}</span></td>
                      <td className="time-cell">{relativeTime(op.updatedAt)}</td>
                      <td className="row-arrow">→</td>
                    </tr>
                  ))}
                  {!loading && visible.length === 0 && (
                    <tr><td colSpan={5} className="empty-state">No operations match this filter.</td></tr>
                  )}
                  {loading && operations.length === 0 && (
                    <tr><td colSpan={5} className="empty-state">Loading operations from the database…</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <span>Showing {visible.length} of {counts.total} database operations</span>
              <span>{lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString()}` : "Waiting for first load"}</span>
            </div>
          </section>

          <section className="detail-grid">
            <article className="detail-card" id="timeline">
              <div className="section-heading">
                <div><div className="eyebrow">OPERATION INSPECTOR</div><h2>Event timeline</h2></div>
                <span className="detail-id">{selected?.id ?? "—"}</span>
              </div>
              {selected ? (
                <>
                  <div className="operation-summary">
                    <div><span className="muted-label">OPERATION STATE</span><strong>{statusLabel(selected.status)}</strong></div>
                    <div><span className="muted-label">AMOUNT</span><strong>{formatAmount(selected.amountMinor, selected.currency)}</strong></div>
                  </div>
                  <div className="operation-summary">
                    <div><span className="muted-label">PAYPAL ORDER</span><strong>{selected.paypalOrderId ?? "Not assigned"}</strong></div>
                    <div><span className="muted-label">PROVIDER STATE</span><strong>{selected.providerStatus ?? "Unknown"}</strong></div>
                  </div>
                  {selected.lastErrorCode && <p className="error-code">Last error: {selected.lastErrorCode}</p>}

                  {/* ── Checkout initiation action ─────────────────────── */}
                  <div className="checkout-action" aria-label="Checkout action">
                    {selected.status === "created" && operatorAuthorized ? (
                      <>
                        <button
                          className="checkout-button"
                          onClick={() => void startCheckout(selected.id)}
                          disabled={checkoutInFlight}
                          aria-busy={checkoutInFlight}
                          aria-label="Start PayPal Sandbox checkout for this operation"
                        >
                          {checkoutInFlight ? (
                            <span className="checkout-loading">Creating order…</span>
                          ) : (
                            <>▶ Start PayPal checkout</>
                          )}
                        </button>
                        <p className="checkout-help">
                          Creates a PayPal Sandbox order and opens PayPal for buyer approval.
                          This does not capture payment immediately.
                        </p>
                      </>
                    ) : selected.status === "created" && !operatorAuthorized ? (
                      <p className="checkout-help">
                        Authorize with an operator token (sidebar) to enable checkout.
                      </p>
                    ) : null}
                    {checkoutError && (
                      <div className="checkout-error" role="alert">
                        <strong>Checkout error:</strong> {checkoutError}
                        <button
                          className="filter-button"
                          onClick={() => setCheckoutError(null)}
                          style={{ marginLeft: "8px", fontSize: "10px" }}
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="timeline">
                    {[...selected.events].sort((a, b) => a.sequence - b.sequence).map((event) => {
                      const state = eventState(event.type, event.toStatus);
                      return (
                        <div className="timeline-event" key={`${selected.id}-${event.sequence}`}>
                          <div className={`timeline-marker marker-${state}`}>{state === "done" ? "✓" : state === "warn" ? "!" : "·"}</div>
                          <div className="timeline-copy">
                            <strong>{eventTitle(event.type)}</strong>
                            <p>{eventDetail(event)}</p>
                            <p className="event-meta">#{event.sequence} · {event.source} · {new Date(event.occurredAt).toLocaleString()}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : <p className="empty-state">{loading ? "Loading operation history…" : "Choose an operation to inspect its events."}</p>}
            </article>

            <article className="detail-card integration-card" id="integration">
              <div className="eyebrow">INTEGRATION STATUS</div>
              <h2>Provider connection</h2>
              <p className="integration-description">CaptureGuard has created Sandbox orders through the PayPal REST API. An order being created is not the same as a completed or captured payment.</p>
              <div className="integration-row">
                <span className="provider-logo">P</span>
                <div><strong>PayPal REST API</strong><small>Sandbox order creation</small></div>
                <span className={`status status-${sandboxOrders > 0 ? "succeeded" : "processing"}`}><span />{sandboxOrders > 0 ? "Order created" : "No orders yet"}</span>
              </div>
              <div className="integration-row">
                <span className="provider-logo database-logo">DB</span>
                <div><strong>Operation store</strong><small>Durable state and event history</small></div>
                <span className="status status-succeeded"><span /> Connected</span>
              </div>
              <div className="integration-note"><span>i</span> {sandboxOrders} operation(s) have a PayPal order ID. This dashboard does not claim that any order has been captured unless the provider confirms it.</div>
              <div className="integration-note"><span>↻</span> Refresh reloads persisted records. Reconciliation is not yet complete merely because an operation is marked as requiring it.</div>
            </article>
          </section>

          <footer className="footer">
            <span>CaptureGuard <span className="footer-dot">·</span> Payment reliability for AI agents</span>
            <span>Live database <span className="footer-dot">·</span> v0.2.0</span>
          </footer>
        </div>
      </section>
    </main>
  );
}

