import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of two token strings.
 * Returns false if either value is missing or empty.
 */
export function matchesToken(
  expected: string | undefined,
  supplied: string | null | undefined,
): boolean {
  if (!expected || !supplied) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);

  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * UUID v1–v8 validation regex. Used to validate operation IDs.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUUID(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Validate that the request's Origin header (if present) matches the
 * server's own origin. For state-changing requests this provides
 * lightweight CSRF protection beyond what CORS offers alone.
 *
 * Rules:
 * - If no Origin header is sent (e.g. same-origin non-preflight),
 *   fall through to the Host header comparison.
 * - Reject if Origin is present but does not match.
 * - Always succeeds for GET/HEAD (non-mutating methods).
 */
export function validateOrigin(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return true;

  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");

  if (origin) {
    try {
      const originUrl = new URL(origin);
      return (
        originUrl.protocol === requestUrl.protocol &&
        originUrl.host === requestUrl.host
      );
    } catch {
      return false;
    }
  }

  const host = request.headers.get("host");
  if (host) {
    return host.toLowerCase() === requestUrl.host.toLowerCase();
  }

  // Fall back to the request's own URL when neither Origin nor Host is sent.
  // This is intentionally permissive for same-origin server-to-server calls,
  // but it still rejects unexpected cross-origin browser requests.
  return true;
}
