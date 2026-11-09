// End-to-end through the HTTP API, no LLM: every protection, the PayPal
// hold/capture/void/refund flow, the store kit and the owner controls.
// Needs `pnpm server` running (mock or sandbox mode).
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
await api("POST", "/api/owner/pause", { paused: false });

const buy = async (store: string, product: string, params: Record<string, string> = {}) => {
  const r = await api("POST", "/agent/v1/buy", { store, product_id: product, params }, token);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json as { purchases: { outcome: string; reason?: string; amount_usd: number }[]; data?: any };
};
const outcome = (r: Awaited<ReturnType<typeof buy>>) => r.purchases[0];

let capturedId = "";

await check("agent API rejects a bad token", async () => {
  assert.equal((await api("GET", "/agent/v1/budget", undefined, "at_nope")).status, 401);
});

await check("stores are listed with products and reputation", async () => {
  const r = await api("GET", "/agent/v1/stores", undefined, token);
  assert.ok(r.json.length >= 10, `only ${r.json.length} stores`);
});

await check("honest store: hold, deliver, verify, capture, real data", async () => {
  const r = await buy("coindata", "coindata-1", { ids: "solana" });
  assert.equal(outcome(r).outcome, "captured", JSON.stringify(r.purchases));
  assert.ok(r.data?.prices?.solana?.usd > 0, "no SOL price delivered");
  const p = (await api("GET", "/agent/v1/purchases", undefined, token)).json[0];
  assert.ok(p.paypal.authorizationId && p.paypal.captureId, "missing PayPal ids");
  capturedId = p.id;
});

await check("lookalike store is blocked (not approved)", async () => {
  const o = outcome(await buy("coindatas", "coindatas-1"));
  assert.equal(o.outcome, "blocked");
  assert.match(o.reason ?? "", /not approved/);
});

await check("invoice above listed price is blocked before PayPal", async () => {
  const o = outcome(await buy("flightdeals", "flightdeals-1"));
  assert.equal(o.outcome, "blocked");
  assert.match(o.reason ?? "", /listed price/);
});

await check("billing loop stops at the store's daily budget", async () => {
  const r = await buy("liveticker", "liveticker-1", { ids: "solana" });
  const outs = r.purchases.map((p) => p.outcome);
  assert.ok(outs.filter((o) => o === "captured").length >= 2, outs.join(","));
  assert.equal(outs.at(-1), "blocked", outs.join(","));
  assert.match(r.purchases.at(-1)?.reason ?? "", /store's daily budget/);
});

await check("junk delivery is rejected and the hold voided", async () => {
  const o = outcome(await buy("dailydigest", "dailydigest-1"));
  assert.equal(o.outcome, "voided", JSON.stringify(o));
});

await check("gift cards are blocked (store and category not allowed)", async () => {
  assert.equal(outcome(await buy("giftcardsnow", "giftcardsnow-1")).outcome, "blocked");
});

await check("agent token cannot use the owner API", async () => {
  assert.equal((await api("PUT", "/api/owner/mandate", { dailyLimit: 10000 }, token)).status, 403);
});

await check("owner refunds a captured purchase; budget is credited back", async () => {
  const before = (await api("GET", "/agent/v1/budget", undefined, token)).json.spent_today_usd;
  const r = await api("POST", `/api/purchases/${capturedId}/refund`, { reason: "test refund" });
  assert.equal(r.json.status, "refunded", JSON.stringify(r.json));
  const after = (await api("GET", "/agent/v1/budget", undefined, token)).json.spent_today_usd;
  assert.ok(after < before, `spent ${before} -> ${after}`);
});

await check("store kit: draft, publish, approve, then an agent buys there", async () => {
  const d = await api("POST", "/api/storekit/draft", { name: "Glyph Studio", text: "Icon pack, 3.50, 120 line icons in SVG\nLogo kit, 6, 20 logo templates" });
  assert.equal(d.status, 200, JSON.stringify(d.json));
  const s = await api("POST", "/api/storekit/publish", { draft: d.json.draft });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  await api("POST", `/api/owner/stores/${s.json.id}/approve`, { dailyCap: 20 });
  const product = s.json.products[0];
  const o = outcome(await buy(s.json.slug, product.id));
  assert.equal(o.outcome, "captured", JSON.stringify(o));
});

await check("owner pause blocks everything", async () => {
  await api("POST", "/api/owner/pause", { paused: true });
  const o = outcome(await buy("coindata", "coindata-1"));
  await api("POST", "/api/owner/pause", { paused: false });
  assert.equal(o.outcome, "blocked");
  assert.match(o.reason ?? "", /paused/);
});

await check("store that never delivers: hold voided after the timeout", async () => {
  const o = outcome(await buy("quickquote", "quickquote-1"));
  assert.equal(o.outcome, "voided", JSON.stringify(o));
});

console.log(`\n${passed} checks passed`);
