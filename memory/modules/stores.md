---
tags:
  - memory
  - module
  - agenttrust
last_updated: 2026-11-09
related_files:
  - "server/stores/storefront.ts"
  - "server/stores/demo.ts"
  - "server/storekit.ts"
---

# Stores

**Purpose:** storefront protocol (`agent-store.json`, `catalog`, `quote`, `fulfil`), 10 demo stores, AI store kit.

## Main functions / classes
- Behaviors: honest, overcharge (x4 quote), pricejump (49.99 on renewal), ghost (never ships), junk (placeholder delivery)
- `draftStore` (Gemini, CSV fallback), `publishStore`

## Gotchas
> [!warning]
> Demo store URLs follow PUBLIC_BASE_URL on every boot (seed).

See also: [[decisions]], [[architecture]]
