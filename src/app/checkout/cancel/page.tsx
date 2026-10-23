"use client";

import Link from "next/link";

/**
 * /checkout/cancel
 *
 * The buyer returns here if they cancel the PayPal approval flow.
 *
 * This page does NOT modify the operation state. The operation may
 * still be in "awaiting_approval" status and could potentially be
 * completed if the buyer returns to PayPal.
 *
 * No payment was captured. The operation requires reconciliation
 * or manual review before any further action.
 */

export default function CheckoutCancelPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Arial, Helvetica, sans-serif",
        background: "#f0ecdf",
        color: "#171717",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <div
        style={{
          background: "#fffdf5",
          border: "3px solid #171717",
          padding: "2.5rem 2rem",
          maxWidth: "560px",
          width: "100%",
        }}
      >
        <div
          style={{
            width: "48px",
            height: "48px",
            display: "grid",
            placeItems: "center",
            background: "#ff3ca6",
            border: "2px solid #171717",
            fontWeight: 900,
            fontSize: "22px",
            color: "#171717",
            margin: "0 auto 1.5rem",
          }}
        >
          ✕
        </div>

        <h1
          style={{
            fontSize: "1.6rem",
            fontWeight: 950,
            letterSpacing: "-0.5px",
            textTransform: "uppercase",
            margin: "0 0 0.75rem",
          }}
        >
          Checkout cancelled
        </h1>

        <p style={{ lineHeight: 1.6, margin: "0 0 1.25rem", color: "#66645d" }}>
          You cancelled the PayPal Sandbox approval. No payment was captured for
          this operation.
        </p>

        <div
          style={{
            background: "#f0ecdf",
            border: "2px solid #171717",
            padding: "1rem",
            marginBottom: "1.5rem",
            fontSize: "12px",
            lineHeight: 1.6,
          }}
        >
          <strong style={{ display: "block", marginBottom: "0.4rem" }}>
            ℹ Operation status
          </strong>
          The operation may still have a PayPal order in &quot;awaiting approval&quot;
          state. Return to the dashboard to inspect the operation or
          reconcile its provider state.
        </div>

        <Link
          href="/"
          style={{
            display: "inline-block",
            background: "#171717",
            color: "#f0ecdf",
            border: "2px solid #171717",
            padding: "0.6rem 1.5rem",
            fontWeight: 800,
            fontSize: "12px",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            textDecoration: "none",
          }}
        >
          ← Return to dashboard
        </Link>
      </div>

      <p
        style={{
          marginTop: "1.5rem",
          fontSize: "11px",
          color: "#66645d",
          fontFamily: "'Courier New', monospace",
        }}
      >
        CaptureGuard · Cancellation does not automatically fail the operation
      </p>
    </main>
  );
}
