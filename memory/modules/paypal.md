---
tags:
  - memory
  - module
  - agenttrust
last_updated: 2026-11-09
related_files:
  - "server/paypal.ts"
  - "scripts/paypal-check.ts"
---

# PayPal

**Purpose:** PayPal REST (sandbox) and a mock with the same `PaymentProvider` interface.

## Main functions / classes
- `createSetupToken`, `createPaymentToken` — Vault v3, owner approves once
- `authorize` — Orders v2 AUTHORIZE with `vault_id`; calls /authorize if not completed
- `capture`, `void`, `refund` — Payments v2; idempotency via PayPal-Request-Id

## Gotchas
> [!warning]
> Sandbox app needs "Save payment methods" (Vault) enabled. `pnpm paypal:check` verifies. On Render, pin DEMO_PAYMENT_TOKEN_ID so restarts stay connected.

See also: [[decisions]], [[architecture]]
