---
tags:
  - memory
  - decisions
  - agenttrust
last_updated: 2026-11-09
---

# Decisions

## 2026-11-09 — PayPal authorization as escrow
- **Decision:** every agent purchase is an Orders v2 AUTHORIZE; capture only after verified delivery, void otherwise.
- **Why:** money is held, not moved, so a failed delivery costs the owner nothing; maps PayGuard's on-chain escrow to PayPal.
- Affects: [[trust-engine]], [[paypal]]

## 2026-11-09 — Vaulted PayPal, approve once
- **Decision:** owner approves a Vault v3 setup token once; agents use the payment token (no checkout window).
- **Why:** agents can't click PayPal approval pages. Fallback if Vault is unavailable: per-order approval.

## 2026-11-09 — Mock provider with the same interface
- **Decision:** `PAYPAL_MODE=mock` mirrors every flow in memory.
- **Why:** build and test before sandbox keys exist; offline demos.

## 2026-11-09 — Rules before PayPal
- **Decision:** quote → mandate checks happen before any PayPal call; blocked purchases never touch PayPal.

Back to [[index]]
