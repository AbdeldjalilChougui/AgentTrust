// MCP server: puts AgentTrust in front of any MCP client (Claude Desktop,
// Claude Code, Cursor...). The client gets shopping tools; every purchase still
// goes through the owner's rules and the PayPal hold.
//   claude mcp add agenttrust -e AGENTTRUST_TOKEN=at_... -- pnpm --dir /path/to/AgentTrust mcp
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.AGENTTRUST_URL ?? "http://localhost:4500").replace(/\/$/, "");
const TOKEN = process.env.AGENTTRUST_TOKEN ?? "";

async function call(method: string, path: string, body?: object) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `AgentTrust answered ${res.status}`);
  return json;
}
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

const server = new McpServer({ name: "agenttrust", version: "0.1.0" });

server.registerTool(
  "search_stores",
  { description: "Find agent-ready stores and their products (product_id, price in USD, reputation).", inputSchema: { query: z.string().optional() } },
  async ({ query }) => text(await call("GET", `/agent/v1/stores?q=${encodeURIComponent(query ?? "")}`)),
);
server.registerTool(
  "buy",
  {
    description:
      "Buy a product with the owner's PayPal. The money is only held until the delivery is verified, then captured; failed deliveries are voided. Returns the outcome and the delivered data.",
    inputSchema: {
      store: z.string().describe("store id from search_stores"),
      product_id: z.string(),
      params: z.record(z.string(), z.string()).optional().describe('e.g. {"check_in":"2026-11-20","guest":"Sam"}'),
    },
  },
  async ({ store, product_id, params }) => text(await call("POST", "/agent/v1/buy", { store, product_id, params })),
);
server.registerTool(
  "budget_status",
  { description: "The owner's spending rules for this agent and what is left today.", inputSchema: {} },
  async () => text(await call("GET", "/agent/v1/budget")),
);
server.registerTool(
  "my_purchases",
  { description: "Recent purchases with their PayPal outcome (captured, voided, blocked, refunded).", inputSchema: {} },
  async () => text(await call("GET", "/agent/v1/purchases")),
);
server.registerTool(
  "paypal",
  {
    description:
      "Run a PayPal Agent Toolkit tool under the owner's policy. Read-only tools (get_order, get_refund, get_shipment_tracking, list_transactions, list_disputes, get_dispute) pass through; tools that move money must go through buy or dispute.",
    inputSchema: { tool: z.string(), args: z.record(z.string(), z.string()).optional() },
  },
  async ({ tool, args }) => text(await call("POST", "/agent/v1/paypal", { tool, args })),
);
server.registerTool(
  "dispute",
  { description: "Ask for a refund of a captured purchase that turned out wrong.", inputSchema: { purchase_id: z.string(), reason: z.string() } },
  async ({ purchase_id, reason }) => text(await call("POST", "/agent/v1/dispute", { purchase_id, reason })),
);

await server.connect(new StdioServerTransport());
