---
tags:
  - memory
  - index
  - agenttrust
last_updated: 2026-11-09
---

# AgentTrust

Safe PayPal payments for AI agents: owner mandate + PayPal authorize/capture/void/refund escrow + AI delivery verification, plus an AI store kit that makes shops agent-ready. Built for the PayPal AI Hackathon (deadline 2026-11-12 12:00 PT).

## Stack
- Node 22+, TypeScript, Express, tsx (server, MCP, scripts)
- PayPal REST: Vault v3, Orders v2 AUTHORIZE, Payments v2 capture/void/refund
- Gemini Interactions API (agent, verifier, store kit)
- Web: Vite + React + Tailwind + AG Grid 36 (community)
- Hosting: Render free (`render.yaml`)

## Map
- [[architecture]] — how a purchase flows
- [[decisions]] — why things were built this way
- [[log]] — recent changes
- [[modules]] — base view of module notes

## Modules
- [[trust-engine]] — rules, PayPal hold, fulfil, verify, capture/void, refund
- [[paypal]] — sandbox REST client and mock
- [[stores]] — storefront protocol, demo stores, store kit
- [[agent]] — Gemini agent, attack scene, agent API, MCP
- [[web]] — dashboard, marketplace, store kit UI

## To revisit
- Real sandbox not yet tested: needs PAYPAL_CLIENT_ID/SECRET with Vault enabled
- Single demo owner (no auth on owner API besides refusing agent tokens)
