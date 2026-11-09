---
tags:
  - memory
  - module
  - agenttrust
last_updated: 2026-11-09
related_files:
  - "server/agent.ts"
  - "mcp/server.ts"
  - "server/index.ts"
---

# Agent

**Purpose:** Gemini shopping agent, stolen-token scene, agent HTTP API, MCP server.

## Main functions / classes
- `agentTools` — searchStores, buy (loops streams up to 8), budget, myPurchases, dispute
- `runAgent`, `runAttack` — NDJSON events (start, tool, step, purchase, answer)
- Agent API `/agent/v1/*` (Bearer token); owner API refuses agent tokens (403)

## Gotchas
> [!warning]
> Gemini free tier ~20 req/day/model; verifier also uses Gemini per purchase (falls back to format checks).

See also: [[decisions]], [[architecture]]
