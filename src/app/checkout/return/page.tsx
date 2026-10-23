"use client";

import Link from "next/link";

/**
 * /checkout/return
 *
 * The buyer returns here after completing (or abandoning) the PayPal
 * approval flow. This page does NOT claim that a payment was captured.
 *
 * PayPal appends query parameters (?token=…&PayerID=…) as *hints*,
 * not proof of payment. The operation's actual state is determined only
 * by a provider-confirmed capture persisted in the database.
 *
 * This page:
 * 1. Displays a clear "pending verification" message.
 * 2. Extracts the operation context from the URL path if available,
 *    but never marks an operation as paid.
 * 3. Directs the operator back to the dashboard.
 */

export default function CheckoutReturnPage() {
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
            background: "#d8ff36",
            border: "2px solid #171717",
            fontWeight: 900,
            fontSize: "22px",
            margin: "0 auto 1.5rem",
          }}
        >
          ◷
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
          Payment pending verification
        </h1>

        <p style={{ lineHeight: 1.6, margin: "0 0 1.25rem", color: "#66645d" }}>
          You have returned from the PayPal Sandbox approval page. This does{" "}
          <strong style={{ color: "#171717" }}>not</strong> confirm that a
          payment was captured.
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
            ⚠ What happens next
          </strong>
          The operation must be verified through the provider before it can be
          marked as successful. Return to the dashboard and use the
          reconciliation flow to confirm the payment state.
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
        CaptureGuard · Arrival from PayPal does not equal a confirmed capture
      </p>
    </main>
  );
}
