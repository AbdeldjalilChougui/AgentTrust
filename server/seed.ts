// Demo owner, agent, mandate and marketplace. Idempotent: runs on every boot.
import { BASE_URL, PAYPAL_MODE } from "./env.js";
import { db, newId, newToken, now, save, type Store } from "./db.js";
import { DEMO_MANDATE, DEMO_STORES } from "./stores/demo.js";

export const DEMO_OWNER = "owner_demo";
export const DEMO_AGENT = "agent_demo";

export function seed() {
  const s = db();
  if (!s.owners.find((o) => o.id === DEMO_OWNER)) {
    s.owners.push({ id: DEMO_OWNER, name: "Demo owner", paypal: { status: "none" } });
  }
  const owner = s.owners.find((o) => o.id === DEMO_OWNER)!;
  // A sandbox payment token can be pinned in the environment so a host with
  // no disk (Render free) stays connected across restarts.
  if (process.env.DEMO_PAYMENT_TOKEN_ID && owner.paypal.paymentTokenId !== process.env.DEMO_PAYMENT_TOKEN_ID) {
    owner.paypal = { status: "connected", paymentTokenId: process.env.DEMO_PAYMENT_TOKEN_ID, connectedAt: now(), payerEmail: process.env.DEMO_PAYER_EMAIL };
  }
  if (PAYPAL_MODE === "mock" && owner.paypal.status !== "connected") {
    owner.paypal = { status: "connected", paymentTokenId: "VAULT-MOCK-DEMO", payerEmail: "owner@personal.example.com", connectedAt: now() };
  }

  for (const d of DEMO_STORES) {
    let store = s.stores.find((x) => x.slug === d.slug);
    if (!store) {
      store = {
        id: newId("store"),
        slug: d.slug,
        name: d.name,
        description: d.description,
        category: d.category,
        storefrontUrl: `${BASE_URL}/stores/${d.slug}`,
        products: d.products.map((p, i) => ({ ...p, id: `${d.slug}-${i + 1}` })),
        behavior: d.behavior,
        createdBy: "demo",
        createdAt: now(),
        stats: { sales: 0, delivered: 0, voided: 0, refunded: 0, revenue: 0 },
      } satisfies Store;
      s.stores.push(store);
    }
    store.storefrontUrl = `${BASE_URL}/stores/${d.slug}`; // follows the host
    if (process.env[`PAYEE_${d.slug.toUpperCase()}`]) store.payeeEmail = process.env[`PAYEE_${d.slug.toUpperCase()}`];
  }
  for (const st of s.stores) if (st.createdBy === "store-kit") st.storefrontUrl = `${BASE_URL}/stores/${st.slug}`;

  let agent = s.agents.find((a) => a.id === DEMO_AGENT);
  if (!agent) {
    agent = { id: DEMO_AGENT, ownerId: DEMO_OWNER, name: "Shopping assistant", token: process.env.DEMO_AGENT_TOKEN ?? newToken(), paused: false, createdAt: now() };
    s.agents.push(agent);
  }
  agent.name = "Shopping assistant";
  if (process.env.DEMO_AGENT_TOKEN) agent.token = process.env.DEMO_AGENT_TOKEN;

  if (!s.mandates.find((m) => m.agentId === DEMO_AGENT)) {
    s.mandates.push({
      id: newId("mandate"),
      ownerId: DEMO_OWNER,
      agentId: DEMO_AGENT,
      ...DEMO_MANDATE,
      spentToday: 0,
      dayStart: now(),
      paused: false,
      stores: DEMO_STORES.filter((d) => d.approved).map((d) => ({ storeId: s.stores.find((x) => x.slug === d.slug)!.id, dailyCap: d.dailyCap, spentToday: 0 })),
      totalCaptured: 0,
      totalVoided: 0,
      totalRefunded: 0,
    });
  }
  save();
  return { owner, agent };
}

/** Fresh daily budgets and an unpaused mandate, for a clean demo run. */
export function resetDemo() {
  const m = db().mandates.find((x) => x.agentId === DEMO_AGENT);
  if (!m) return;
  m.spentToday = 0;
  m.dayStart = now();
  m.paused = false;
  m.stores.forEach((r) => (r.spentToday = 0));
  const a = db().agents.find((x) => x.id === DEMO_AGENT);
  if (a) a.paused = false;
  save();
}
