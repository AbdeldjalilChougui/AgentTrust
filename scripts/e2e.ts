// End-to-end through the HTTP API, no LLM: every protection, the PayPal
// hold/capture/void/refund flow, shipment tracking, the Agent Toolkit policy,
// the store kit and the owner controls. Needs `pnpm server` running.
import assert from "node:assert/strict";

const BASE = (process.env.E2E_BASE ?? "http://localhost:4500").replace(/\/$/, "");
let passed = 0;

async function api(method: string, path: string, body?: object, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function check(name: string, fn: () => Promise<void>) {
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    console.log(`✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    console.error(`✗ ${name}\n  ${(e as Error).message}`);
    process.exit(1);
  }
}

const state = (await api("GET", "/api/state")).json;
const token: string = state.agent.token;
console.log(`AgentTrust at ${BASE} · PayPal ${state.paypalMode} · owner PayPal ${state.owner.paypal.status}`);
await api("POST", "/api/owner/reset");

type BuyOut = { purchases: { outcome: string; reason?: string; amount_usd: number }[]; data?: any };
const buy = async (store: string, product: string, params: Record<string, string> = {}) => {
  const r = await api("POST", "/agent/v1/buy", { store, product_id: product, params }, token);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json as BuyOut;
};
const first = (r: BuyOut) => r.purchases[0];
const latest = async () => (await api("GET", "/agent/v1/purchases", undefined, token)).json[0];

let hotelPurchase = "";

await check("agent API rejects a bad token", async () => {
  assert.equal((await api("GET", "/agent/v1/budget", undefined, "at_nope")).status, 401);
});

await check("hotel booking: PayPal hold, confirmation verified, captured", async () => {
  const r = await buy("staywell", "staywell-1", { guest: "Sam" });
  assert.equal(first(r).outcome, "captured", JSON.stringify(r.purchases));
  assert.match(r.data?.confirmation ?? "", /^BK-/);
  const p = await latest();
  assert.ok(p.paypal.orderId && p.paypal.authorizationId && p.paypal.captureId, "missing PayPal ids");
  hotelPurchase = p.id;
});

await check("lookalike hotel site is blocked (not approved)", async () => {
  const o = first(await buy("staywel", "staywel-1"));
  assert.equal(o.outcome, "blocked");
  assert.match(o.reason ?? "", /not approved/);
});

await check("hotel invoicing 4x its listed price is blocked before PayPal", async () => {
  const o = first(await buy("grandplaza", "grandplaza-1"));
  assert.equal(o.outcome, "blocked");
  assert.match(o.reason ?? "", /listed price/);
  assert.equal(o.amount_usd, 480);
});

await check("subscription price jump on renewal is blocked", async () => {
  const r = await buy("pixelly", "pixelly-1");
  assert.deepEqual(r.purchases.map((p) => p.outcome), ["captured", "blocked"], JSON.stringify(r.purchases));
  assert.match(r.purchases[1].reason ?? "", /listed price/);
});

await check("flowers shipped: captured and tracking added to the PayPal order", async () => {
  const o = first(await buy("bloomexpress", "bloomexpress-1"));
  assert.equal(o.outcome, "captured", JSON.stringify(o));
  const p = await latest();
  assert.ok(p.paypal.tracking, "no tracking on the PayPal order");
});

await check("freelancer delivers placeholders: rejected, hold voided", async () => {
  const o = first(await buy("gigdesk", "gigdesk-1"));
  assert.equal(o.outcome, "voided", JSON.stringify(o));
});

await check("gift cards are blocked (store and category not allowed)", async () => {
  assert.equal(first(await buy("gifthub", "gifthub-1")).outcome, "blocked");
});

await check("PayPal Agent Toolkit policy: read allowed, money tools routed or denied", async () => {
  const read = await api("POST", "/agent/v1/paypal", { tool: "get_order", args: { order_id: (await latest()).paypal.orderId ?? "x" } }, token);
  assert.equal(read.json.policy, "allow", JSON.stringify(read.json));
  const pay = await api("POST", "/agent/v1/paypal", { tool: "pay_order", args: {} }, token);
  assert.equal(pay.json.policy, "route");
  const inv = await api("POST", "/agent/v1/paypal", { tool: "send_invoice", args: {} }, token);
  assert.equal(inv.json.policy, "deny");
});

await check("agent token cannot use the owner API", async () => {
  assert.equal((await api("PUT", "/api/owner/mandate", { dailyLimit: 10000 }, token)).status, 403);
});

await check("owner refunds the hotel; budget credited back", async () => {
  const before = (await api("GET", "/agent/v1/budget", undefined, token)).json.spent_today_usd;
  const r = await api("POST", `/api/purchases/${hotelPurchase}/refund`, { reason: "trip cancelled" });
  assert.equal(r.json.status, "refunded", JSON.stringify(r.json));
  const after = (await api("GET", "/agent/v1/budget", undefined, token)).json.spent_today_usd;
  assert.ok(after < before, `spent ${before} -> ${after}`);
});

await check("store kit: AI catalog, publish, approve, agent buys there", async () => {
  const d = await api("POST", "/api/storekit/draft", { name: "Oran Ceramics", text: "Handmade mug, 18, blue glazed mug shipped from Oran\nSet of 4 bowls, 45, shipped in 3 days" });
  assert.equal(d.status, 200, JSON.stringify(d.json));
  const s = await api("POST", "/api/storekit/publish", { draft: d.json.draft });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  await api("POST", `/api/owner/stores/${s.json.id}/approve`, { dailyCap: 100 });
  const o = first(await buy(s.json.slug, s.json.products[0].id));
  assert.equal(o.outcome, "captured", JSON.stringify(o));
});

await check("owner pause blocks everything", async () => {
  await api("POST", "/api/owner/pause", { paused: true });
  const o = first(await buy("pageturner", "pageturner-1"));
  await api("POST", "/api/owner/pause", { paused: false });
  assert.equal(o.outcome, "blocked");
  assert.match(o.reason ?? "", /paused/);
});

await check("flowers never shipped: hold voided after the timeout", async () => {
  const o = first(await buy("quickbloom", "quickbloom-1"));
  assert.equal(o.outcome, "voided", JSON.stringify(o));
});

console.log(`\n${passed} checks passed`);
