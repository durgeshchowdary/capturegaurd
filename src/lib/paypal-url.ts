/**
 * Validates a URL string as a legitimate PayPal Sandbox approval URL.
 *
 * Security considerations:
 * - Only HTTPS is accepted.
 * - The hostname must exactly match known PayPal approval hosts.
 * - No userinfo (embedded credentials) is permitted.
 * - No broad suffix matching that would accept lookalike domains.
 *
 * Known PayPal Sandbox approval hosts:
 * - www.sandbox.paypal.com  (primary approval page)
 * - sandbox.paypal.com      (alternate)
 *
 * Returns the validated URL string if valid, or null if the URL is
 * not a genuine PayPal Sandbox approval URL.
 */

const ALLOWED_PAYPAL_SANDBOX_HOSTS = new Set([
  "www.sandbox.paypal.com",
  "sandbox.paypal.com",
]);

export function validatePayPalApprovalUrl(
  url: string | undefined | null,
): string | null {
  if (!url || typeof url !== "string") return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // Require HTTPS.
  if (parsed.protocol !== "https:") return null;

  // Reject embedded credentials (userinfo).
  if (parsed.username || parsed.password) return null;

  // Exact host match — no suffix checking.
  if (!ALLOWED_PAYPAL_SANDBOX_HOSTS.has(parsed.hostname.toLowerCase())) {
    return null;
  }

  // Return the original provider-issued URL, not a reconstructed one.
  return url;
}

/**
 * Validates and normalizes the CAPTUREGUARD_PUBLIC_URL configuration.
 *
 * Returns the normalized URL (without trailing slash) or null if invalid.
 * In local development (localhost), HTTP is permitted.
 * In all other cases, HTTPS is required.
 */
export function validatePublicUrl(
  rawUrl: string | undefined,
): string | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const isLocalDev =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";

  if (!isLocalDev && parsed.protocol !== "https:") {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }

  // Reject embedded credentials.
  if (parsed.username || parsed.password) return null;

  // Normalize: remove trailing slash.
  return parsed.origin;
}
