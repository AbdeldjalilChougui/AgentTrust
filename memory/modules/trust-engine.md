---
tags:
  - memory
  - module
  - agenttrust
last_updated: 2026-11-09
related_files:
  - "server/trust.ts"
  - "server/verify.ts"
---

# Trust engine

**Purpose:** one purchase end to end.

## Main functions / classes
- `TrustEngine.buy(agent, {store, productId, params})` — quote, `checkRules`, authorize, fulfil (15s timeout), verify, capture/void
- `TrustEngine.dispute(purchaseId, reason)` — refund a captured purchase, credit budgets
- Rule codes: OwnerPaused, AgentPaused, PayPalNotConnected, StoreNotApproved, CategoryNotAllowed, LowReputation, OverListedPrice, OverPerPurchaseCap, OverDailyLimit, OverStoreBudget

## Dependencies
- Uses: [[paypal]], [[stores]]; Used by: [[agent]], [[web]]

## Gotchas
> [!warning]
> Spend is counted at authorization and credited back on void/refund. AI verifier treats download links/licence keys (digital) and booking links (service) as delivered.

See also: [[decisions]], [[architecture]]
