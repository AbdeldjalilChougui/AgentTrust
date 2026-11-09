---
tags:
  - memory
  - module
  - agenttrust
last_updated: 2026-11-09
related_files:
  - "web/src/App.tsx"
  - "web/src/components/Dashboard.tsx"
  - "web/src/components/Marketplace.tsx"
  - "web/src/components/StoreKit.tsx"
---

# Web

**Purpose:** dashboard (stats, scenes, PayPal connect, rules, purchases grid, MCP card), marketplace grid (approve, budgets), store kit.

## Gotchas
> [!warning]
> AG Grid 36 needs `ModuleRegistry.registerModules([AllCommunityModule])` (main.tsx) and the theming API (`gridTheme` in api.ts). Polls the API every 3s.

See also: [[decisions]], [[architecture]]
