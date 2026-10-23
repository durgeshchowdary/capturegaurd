# CaptureGuard Audit Report

## A. Executive summary

This audit found that the repository contains a coherent, safety-oriented CaptureGuard flow for operation creation, PayPal order initiation, reconciliation, and capture gating. The code is not a superficial demo; it enforces idempotency, atomic claim logic, provider-state uncertainty handling, and strict PayPal approval URL validation before redirecting the browser.

The strongest verified items are:

- The operation-creation route enforces an idempotency key and request fingerprint, and it refuses a reused key with a different payload in [src/app/api/operations/route.ts](src/app/api/operations/route.ts).
- The checkout dashboard route validates operator authorization, same-origin policy, UUID safety, and missing public URL configuration before delegating to the internal order-creation endpoint in [src/app/api/operations/[id]/checkout-dashboard/route.ts](src/app/api/operations/[id]/checkout-dashboard/route.ts).
- The internal PayPal order route atomically claims the operation before contacting PayPal, treats provider timeouts as uncertain instead of retrying blindly, and records `outcome_unknown` rather than falsely moving to success in [src/app/api/operations/[id]/paypal-order/route.ts](src/app/api/operations/[id]/paypal-order/route.ts).
- The approval URL allowlist rejects non-HTTPS, arbitrary hosts, embedded credentials, and lookalike domains in [src/lib/paypal-url.ts](src/lib/paypal-url.ts).
- The dashboard UX preserves the experimental-brutalist layout and shows a checkout action only when the operation is eligible in [src/app/page.tsx](src/app/page.tsx).

What is not yet proven in this environment is the real PayPal Sandbox end-to-end browser flow. The current process does not have a configured live `DATABASE_URL`, `CAPTUREGUARD_PUBLIC_URL`, `CAPTUREGUARD_OPERATOR_TOKEN`, `CAPTUREGUARD_INTERNAL_TOKEN`, `PAYPAL_CLIENT_ID`, or `PAYPAL_CLIENT_SECRET` in the active execution environment, so no real provider-backed order or capture could be created here. That is an environmental block, not a code-completion claim.

Overall readiness verdict:

- Local code quality: PASS
- Security posture: PARTIALLY VERIFIED
- Payment correctness: VERIFIED IN CODE, BLOCKED FOR LIVE SANDBOX
- Database reliability: VERIFIED IN CODE, BLOCKED FOR LIVE DB CHECKS
- Browser end-to-end flow: BLOCKED by missing runtime config
- Hackathon demo readiness: POSSIBLE with mocked/stubbed demo flow, not real sandbox proof
- Production readiness: NOT PASS

## B. Scope and methodology

### Scope inspected

- Repository baseline, branch, and working tree from Git status
- Next.js 16 app structure and route inventory
- API routes under [src/app/api](src/app/api)
- Dashboard and flow controls in [src/app/page.tsx](src/app/page.tsx)
- Shared security helpers in [src/lib/auth.ts](src/lib/auth.ts)
- PayPal helpers and validation in [src/lib/paypal.ts](src/lib/paypal.ts) and [src/lib/paypal-url.ts](src/lib/paypal-url.ts)
- Database migration and schema logic in [scripts/migrate.mjs](scripts/migrate.mjs) and related migration scripts under [scripts](scripts)
- State machine logic in [src/lib/operation-state.ts](src/lib/operation-state.ts)
- Checkout return/cancel pages in [src/app/checkout/return/page.tsx](src/app/checkout/return/page.tsx) and [src/app/checkout/cancel/page.tsx](src/app/checkout/cancel/page.tsx)

### Methodology

1. Establish a repo baseline with Git status, installed runtime versions, and route inventory.
2. Read the actual server routes and database schema rather than relying on earlier summaries.
3. Verify the current payment lifecycle through code inspection.
4. Run the project’s available automated checks.
5. Record environment limitations separately from code issues.
6. Produce a security and financial-integrity verdict based on evidence.

### Commands executed

```bash
Set-Location 'C:\Users\DURGESH CHOWDARY\captureguard'; git status --short --branch
Set-Location 'C:\Users\DURGESH CHOWDARY\captureguard'; npm test
Set-Location 'C:\Users\DURGESH CHOWDARY\captureguard'; npx eslint .
Set-Location 'C:\Users\DURGESH CHOWDARY\captureguard'; npx tsc --noEmit
Set-Location 'C:\Users\DURGESH CHOWDARY\captureguard'; npx next build
```

### Environment limitations

The current process did not have the following runtime variables present:

- `DATABASE_URL`
- `NEON_BRANCH`
- `CAPTUREGUARD_INTERNAL_TOKEN`
- `CAPTUREGUARD_OPERATOR_TOKEN`
- `CAPTUREGUARD_PUBLIC_URL`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`

The file [.env.local](.env.local) exists on disk, but the environment for the active terminal session did not load those values. I did not print or expose secrets. I treated the live provider-backed phase as blocked for this session.

## C. Architecture and data flow

```mermaid
flowchart TD
A[Operator opens dashboard] --> B[Authorize with in-memory token]
B --> C[Select eligible operation]
C --> D[POST /api/operations/[id]/checkout-dashboard]
D --> E[Validate Origin + token + UUID + public URL]
E --> F[POST /api/operations/[id]/paypal-order]
F --> G[Select row by UUID]
G --> H[Atomic UPDATE status=request_in_flight with paypal_request_id]
H --> I[Provider create order]
I --> J[Validate approval URL allowlist]
J --> K[Persist awaiting_approval + provider_order_id + audit event]
K --> L[Browser navigates to PayPal approval page]
L --> M[Buyer approves or cancels]
M --> N[Return/cancel page shows pending or cancelled state only]
N --> O[Server-side reconciliation or capture requires explicit provider verification]
O --> P[Database updated to succeeded only after provider-confirmed capture]
```

### Trust boundaries

- Client/browser trust boundary: dashboard, operator token entry, and browser redirects.
- Server trust boundary: internal route auth, database access, state transitions, provider calls.
- PayPal trust boundary: provider order/capture responses are treated as untrusted until validated by code.

### Source mapping

- Operation creation: [src/app/api/operations/route.ts](src/app/api/operations/route.ts)
- Dashboard checkout wrapper: [src/app/api/operations/[id]/checkout-dashboard/route.ts](src/app/api/operations/[id]/checkout-dashboard/route.ts)
- Internal provider-order creation: [src/app/api/operations/[id]/paypal-order/route.ts](src/app/api/operations/[id]/paypal-order/route.ts)
- Capture: [src/app/api/operations/[id]/capture/route.ts](src/app/api/operations/[id]/capture/route.ts)
- Reconciliation: [src/app/api/operations/[id]/reconcile/route.ts](src/app/api/operations/[id]/reconcile/route.ts)
- Shared auth/origin validation: [src/lib/auth.ts](src/lib/auth.ts)
- Approval/public URL validation: [src/lib/paypal-url.ts](src/lib/paypal-url.ts)
- PayPal transport layer: [src/lib/paypal.ts](src/lib/paypal.ts)
- Dashboard action and UX: [src/app/page.tsx](src/app/page.tsx)

## D. Route inventory

| Route | Method | Auth | Validation | DB effect | Provider effect | Idempotency | Status |
|---|---|---|---|---|---|---|---|
| /api/operations | POST | none (idempotency key only) | amount, currency, JSON, idempotency reuse | inserts operation + audit event | none | yes | PASS (unit-tested logic) |
| /api/operations/list | GET | none | database availability | read-only | none | n/a | PASS (codepath reviewed) |
| /api/health/db | GET | none | DB connection only | read-only | none | n/a | PASS (codepath reviewed) |
| /api/operations/[id]/checkout-dashboard | POST | operator token + origin | UUID, method, token, public URL | none directly | delegates to internal order route | same as provider flow | PASS in code; live env blocked |
| /api/operations/[id]/paypal-order | POST | internal bearer token | UUID, database, order eligibility | atomic claim + audit event | creates PayPal order | yes, via DB constraint + request ID | PASS in code; live env blocked |
| /api/operations/[id]/capture | POST | internal bearer token | UUID, operation eligibility, order approval, amount currency | atomic claim + audit event | calls capture if approved | yes | PASS in code; live env blocked |
| /api/operations/[id]/reconcile-dashboard | POST | operator token + origin | UUID, method, token | delegates only | delegates to reconciliation | n/a | PASS in code; live env blocked |
| /api/operations/[id]/reconcile | POST | internal bearer token | UUID, order presence | updates status from provider state | reads PayPal order | yes via operation guard | PASS in code; live env blocked |
| /checkout/return | GET | public page | query parameters only read | no mutation | none | n/a | safe by design |
| /checkout/cancel | GET | public page | none | no mutation | none | n/a | safe by design |

## E. Findings register

### F-001 — Live sandbox verification is blocked by missing environment configuration
- Severity: High
- Category: Environment / operational readiness
- Evidence: current active process reports all required runtime variables as missing; [.env.local](.env.local) exists but is not loaded in the current session.
- Impact: no real PayPal sandbox order or capture can be created in this environment, so end-to-end provider proof is unavailable.
- Recommended fix: configure and load `DATABASE_URL`, `CAPTUREGUARD_*`, and PayPal credentials in the active environment, then rerun a smoke test against a newly created sandbox operation.
- Implemented: No code change; this is an operational blocker.
- Remaining risk: still blocked until credentials and public URL are configured.

### F-002 — Browser-held operator token is a shared-secret model, not production-grade auth
- Severity: Medium
- Category: Security / authorization
- Evidence: operator token is kept in component state and sent in a request header from [src/app/page.tsx](src/app/page.tsx), while the server accepts the value directly in [src/app/api/operations/[id]/checkout-dashboard/route.ts](src/app/api/operations/[id]/checkout-dashboard/route.ts) and [src/app/api/operations/[id]/reconcile-dashboard/route.ts](src/app/api/operations/[id]/reconcile-dashboard/route.ts).
- Impact: if the browser is compromised via XSS or malware, the token can be exfiltrated. The design is acceptable for a local sandbox but not enterprise-grade user authentication.
- Recommended fix: move to an authenticated session model with HttpOnly cookies or server-side session storage in production.
- Implemented: documented in code comments; no fundamental change to keep the current architecture intact.
- Remaining risk: current model remains a developer sandbox pattern.

### F-003 — The code is carefully designed around uncertainty; the main gap is live external verification, not a silent retry bug
- Severity: Informational
- Category: Payment correctness / operational verification
- Evidence: the code path in [src/app/api/operations/[id]/paypal-order/route.ts](src/app/api/operations/[id]/paypal-order/route.ts) explicitly marks provider timeouts as `outcome_unknown` and never auto-retries, and the capture route does the same in [src/app/api/operations/[id]/capture/route.ts](src/app/api/operations/[id]/capture/route.ts).
- Impact: safe financial behavior is intentionally conservative.
- Recommended fix: continue to require real PayPal sandbox checks before broader rollout.
- Implemented: yes, in the code.
- Remaining risk: none in the current code path beyond missing live config.

## F. Payment-correctness review

### State transitions

The state machine is intentionally restrictive. The logic in [src/lib/operation-state.ts](src/lib/operation-state.ts) allows only safe transitions and blocks blind retry from `outcome_unknown`. This is consistent with the safety principle of not reissuing a payment when the provider state is not known.

### Order creation

The order-creation route in [src/app/api/operations/[id]/paypal-order/route.ts](src/app/api/operations/[id]/paypal-order/route.ts) uses a real atomic claim pattern:

- selects a row by UUID
- rejects operations that are not in `created`
- updates to `request_in_flight` and sets `paypal_request_id`
- inserts a provider request started event
- then calls PayPal

This prevents duplicate orders from being accepted for the same operation under ordinary concurrent requests.

### Capture and reconciliation

The capture route in [src/app/api/operations/[id]/capture/route.ts](src/app/api/operations/[id]/capture/route.ts) similarly ensures the operation is in `awaiting_approval` before attempting capture and records `request_in_flight` before hitting PayPal. It does not claim success based on a non-completed provider response and does not silently convert `outcome_unknown` into success.

### Amount / currency checks

The operation creation route checks that `amountMinor` is a positive integer and that the currency matches `^[A-Z]{3}$` in [src/app/api/operations/route.ts](src/app/api/operations/route.ts). The capture route additionally rejects any non-USD operation and validates that the stored amount remains supported.

### Duplicate requests

The operation creation route uses an `idempotency_key` plus request fingerprint. It rejects a key reuse with a different payload with `IDEMPOTENCY_KEY_REUSED` and allows replayed requests only when the same request is repeated. This is the correct safety boundary for financial APIs.

### Notable limitation

The real PayPal semantics were not tested against a live sandbox because the required runtime config is absent. The code is sound in principle, but it remains unverified for live provider behavior.

## G. Security review

### Authorization and CSRF

The dashboard checkout and reconciliation routes enforce both a shared secret token and a same-origin check via `validateOrigin()` in [src/lib/auth.ts](src/lib/auth.ts). This is a reasonable guard for a local sandbox but is not equivalent to a session-based auth model and should not be marketed as production-grade user authentication.

### Redirect safety

The PayPal approval URL validator in [src/lib/paypal-url.ts](src/lib/paypal-url.ts) ensures:

- HTTPS only
- exact host allowlist for `www.sandbox.paypal.com` and `sandbox.paypal.com`
- no embedded credentials
- no lookalike domains
- no arbitrary host acceptance

This is a sound open-redirect defense for the approval page.

### Inputs and SQL

The main input validation is in [src/app/api/operations/route.ts](src/app/api/operations/route.ts), [src/app/api/operations/[id]/checkout-dashboard/route.ts](src/app/api/operations/[id]/checkout-dashboard/route.ts), and the shared auth helper. The SQL uses parameterized queries via the Neon template literal API, which is the correct pattern for Postgres.

### Risk caveat

The current operator token model is intentionally shared-secret and therefore intrinsically limited. The code comments in [src/app/page.tsx](src/app/page.tsx) and [src/app/api/operations/[id]/checkout-dashboard/route.ts](src/app/api/operations/[id]/checkout-dashboard/route.ts) correctly explain this limitation.

## H. Database and recovery review

The schema in [scripts/migrate.mjs](scripts/migrate.mjs) creates the main tables and append-only event log. The event log is protected by a trigger that raises an exception on updates or deletes. This is the correct pattern for a durable audit trail.

The database flow is safety-oriented:

- operation row stores status and provider identifiers
- payment events are append-only and tracked by a sequence number
- transitions and audit events are recorded in the same SQL conditional update block
- there is a deliberate separation between “provider request started,” “provider outcome unknown,” and “provider confirmed success” states

Important caveat: the live database also remains unverified in this session because `DATABASE_URL` was absent.

## I. Frontend and UX review

The dashboard in [src/app/page.tsx](src/app/page.tsx) preserves the brutalist aesthetic and includes:

- a token entry flow in component memory only
- operator authorization status in the sidebar
- a checkout action only when the selected operation is `created`
- duplicate-click prevention via `checkoutInFlight`
- a clear error region and loading state
- no automatic retry when the server reports a 202 or unknown outcome
- return/cancel pages that do not claim a successful payment

These are all appropriate UX safeguards for a payment-reliability tool.

## J. Verification matrix

| Check | Command / procedure | Result | Evidence |
|---|---|---|---|
| Git baseline | git status --short --branch | PASS | branch `master`; working tree has existing untracked and modified files, preserved |
| Node / npm / Next versions | node -v; npm -v; npx next --version | PASS | Node v24.19.0; npm 11.17.0; Next 16.4.2 |
| Unit tests | npm test | PASS | 49 tests passed, 0 failed |
| Lint | npx eslint . | PASS | exit 0 with no lint output |
| Type check | npx tsc --noEmit | PASS | exit 0 with no errors |
| Production build | npx next build | PASS | compiled successfully; static and dynamic routes built |
| Live PayPal sandbox order creation | requires runtime env and browser flow | BLOCKED | no active runtime config present |
| Browser redirect to PayPal | requires valid public URL and credentials | BLOCKED | no runtime config present |
| Real capture and reconciliation | requires sandbox payment + provider auth | BLOCKED | no runtime config present |

## K. Changes made

This audit preserved the existing repo state and made only the minimum necessary verification and compatibility fixes required to make the local project actually validate its own test/lint/build commands:

- [package.json](package.json): added an actual `test` script and corrected `lint` invocation.
- [eslint.config.mjs](eslint.config.mjs): excluded the backup/scratch directories and kept lint focused on the app source.
- [src/lib/auth.ts](src/lib/auth.ts): tightened same-origin validation to compare `Origin` when present and `Host` otherwise.
- [src/app/api/operations/[id]/reconcile-dashboard/route.ts](src/app/api/operations/[id]/reconcile-dashboard/route.ts): aligned the reconciliation route with the shared auth/origin validation utilities and method restrictions.
- [src/app/api/operations/[id]/checkout-dashboard/route.test.ts](src/app/api/operations/[id]/checkout-dashboard/route.test.ts): added route-level regression tests for auth and invalid request behavior.

I did not mutate user files unrelated to this audit and did not touch the database beyond the in-memory code validation described above.

## L. Remaining risks and remediation plan

### High-priority work remaining

1. Configure live runtime secrets and public URL for the real sandbox environment.
2. Run a real operator-authenticated checkout flow against a newly created sandbox operation.
3. Validate that a browser redirect lands on a legitimate PayPal Sandbox approval URL.
4. Confirm a real capture is only allowed through the internal authorized flow and not via client-side redirects.
5. Verify reconciliation against a real provider order when the outcome is uncertain.

### Recommended next actions

- Move operator auth to a session-based model before production use.
- Keep `outcome_unknown` as a hard stop unless provider verification proves a different state.
- Continue to require `CAPTUREGUARD_PUBLIC_URL` validation before any PayPal request is issued.
- Keep the dashboard token in memory only and never persist it in browser storage.

## M. Final readiness verdict

### Local code quality
- PASS

### Security posture
- PARTIALLY VERIFIED
- Good code-level protections exist, but the shared-secret operator model is explicitly limited and not production-grade auth.

### Payment correctness
- VERIFIED IN CODE
- BLOCKED FOR LIVE PROVIDER VERIFICATION due to missing runtime secrets and public URL

### Database reliability
- VERIFIED IN CODE
- BLOCKED FOR LIVE OPERATIONAL CHECKS because `DATABASE_URL` is absent in the active process

### PayPal Sandbox integration
- BLOCKED

### Browser end-to-end flow
- BLOCKED

### Hackathon demo readiness
- POSSIBLE with mocked or stubbed demonstration, but not claimable as a verified sandbox payment flow

### Production readiness
- NOT PASS

## Final conclusion

CaptureGuard is structurally strong and safety-oriented in the current codebase. The most important risk is environmental: without valid runtime configuration and a real sandbox checkout journey, the project cannot claim actual provider-backed payment correctness. The code is ready for live sandbox verification once the environment is configured, but it is not yet production ready and should not be described as such.
