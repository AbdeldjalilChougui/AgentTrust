// The trust layer. Every agent purchase goes:
//   rules (mandate) -> PayPal AUTHORIZE (money held) -> store fulfils ->
//   verify delivery -> CAPTURE (store paid) or VOID (nothing charged)
// A captured purchase can still be disputed: REFUND.
import { createHash } from "node:crypto";
import {
  db, findStore, mandateOf, newId, now, ownerOf, reputation, round2, save,
  type Agent, type Mandate, type Product, type Purchase, type Store,
} from "./db.js";
import { PayPalError, type PaymentProvider } from "./paypal.js";
import { verifyDelivery } from "./verify.js";

export const RULE_TEXT: Record<string, string> = {
  OwnerPaused: "The owner paused all agent spending",
  AgentPaused: "This agent is paused",
  PayPalNotConnected: "The owner has not connected PayPal yet",
  StoreNotApproved: "Store is not approved for this agent",
  CategoryNotAllowed: "Category not allowed by the owner",
  LowReputation: "Store reputation below the owner's minimum",
  OverListedPrice: "Invoice above the store's listed price",
  OverPerPurchaseCap: "Over the per-purchase cap",
  OverDailyLimit: "Over the agent's daily limit",
  OverStoreBudget: "Over this store's daily budget",
  UnknownProduct: "Product not in the store's catalog",
};

export type Listener = (p: Purchase, event: string) => void;
const listeners = new Set<Listener>();
export const onPurchase = (fn: Listener) => (listeners.add(fn), () => listeners.delete(fn));

function step(p: Purchase, name: string, detail?: string) {
  p.timeline.push({ at: now(), step: name, detail });
  p.updatedAt = now();
  save();
  for (const fn of listeners) fn(p, name);
}

/** A new 24h window resets today's counters. */
function rollDay(m: Mandate) {
  if (Date.now() - Date.parse(m.dayStart) >= 86_400_000) {
    m.dayStart = now();
    m.spentToday = 0;
    m.stores.forEach((s) => (s.spentToday = 0));
  }
}

function checkRules(agent: Agent, m: Mandate, store: Store, product: Product, amount: number): string | null {
  const owner = ownerOf(m.ownerId);
  if (m.paused) return "OwnerPaused";
  if (agent.paused) return "AgentPaused";
  if (owner?.paypal.status !== "connected") return "PayPalNotConnected";
  const rule = m.stores.find((s) => s.storeId === store.id);
  if (!rule) return "StoreNotApproved";
  if (m.categories.length && !m.categories.includes(product.category)) return "CategoryNotAllowed";
  const rep = reputation(store);
  if (rep !== null && rep < m.minReputation) return "LowReputation";
  if (amount > product.price + 1e-9) return "OverListedPrice";
  if (amount > m.perPurchaseCap + 1e-9) return "OverPerPurchaseCap";
  rollDay(m);
  if (m.spentToday + amount > m.dailyLimit + 1e-9) return "OverDailyLimit";
  if (rule.dailyCap > 0 && rule.spentToday + amount > rule.dailyCap + 1e-9) return "OverStoreBudget";
  return null;
}

async function post(url: string, body: object, timeoutMs: number) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res;
}

const credit = (m: Mandate, storeId: string, amount: number, createdAt: string) => {
  if (Date.parse(createdAt) >= Date.parse(m.dayStart)) {
    m.spentToday = round2(Math.max(0, m.spentToday - amount));
    const rule = m.stores.find((s) => s.storeId === storeId);
    if (rule) rule.spentToday = round2(Math.max(0, rule.spentToday - amount));
  }
};

export type BuyResult = { purchase: Purchase; data?: unknown };

export class TrustEngine {
  constructor(readonly paypal: PaymentProvider) {}

  async buy(agent: Agent, req: { store: string; productId?: string; params?: Record<string, string> }): Promise<BuyResult> {
    const m = mandateOf(agent.id);
    const store = findStore(req.store);
    if (!m) throw new Error("this agent has no mandate");
    if (!store) throw new Error(`unknown store ${req.store}`);
    const product = store.products.find((x) => x.id === req.productId) ?? (req.productId ? undefined : store.products[0]);

    const p: Purchase = {
      id: newId("pur"),
      ownerId: m.ownerId,
      mandateId: m.id,
      agentId: agent.id,
      storeId: store.id,
      storeName: store.name,
      productId: product?.id ?? String(req.productId),
      productName: product?.name ?? "unknown product",
      listedPrice: product?.price ?? 0,
      invoiceAmount: 0,
      status: "blocked",
      paypal: {},
      createdAt: now(),
      updatedAt: now(),
      timeline: [],
    };
    db().purchases.unshift(p);
    if (!product) {
      p.rule = "UnknownProduct";
      p.reason = RULE_TEXT.UnknownProduct;
      step(p, "blocked", p.reason);
      return { purchase: p };
    }

    // 1. The store quotes. Its listing price is what the owner approved.
    let amount = product.price;
    try {
      const q = await (await post(`${store.storefrontUrl}/quote`, { productId: product.id, params: req.params ?? {} }, 10_000)).json();
      amount = round2(Number(q.amount));
    } catch {
      p.status = "failed";
      p.reason = "store did not quote";
      step(p, "failed", p.reason);
      return { purchase: p };
    }
    p.invoiceAmount = amount;
    step(p, "quoted", `${store.name} asks $${amount.toFixed(2)} (listed $${product.price.toFixed(2)})`);

    // 2. The owner's rules.
    const rule = checkRules(agent, m, store, product, amount);
    if (rule) {
      p.rule = rule;
      p.reason = RULE_TEXT[rule];
      step(p, "blocked", p.reason);
      return { purchase: p };
    }

    // 3. Hold the money on the owner's PayPal. Nothing is charged yet.
    const owner = ownerOf(m.ownerId)!;
    try {
      const a = await this.paypal.authorize({
        amount,
        description: `${store.name}: ${product.name} (AgentTrust)`,
        referenceId: p.id,
        paymentTokenId: owner.paypal.paymentTokenId!,
        payeeEmail: store.payeeEmail,
      });
      p.paypal.orderId = a.orderId;
      p.paypal.authorizationId = a.authorizationId;
    } catch (e) {
      p.status = "failed";
      p.reason = `PayPal: ${(e as Error).message}`;
      step(p, "failed", p.reason);
      return { purchase: p };
    }
    p.status = "authorized";
    m.spentToday = round2(m.spentToday + amount);
    const storeRule = m.stores.find((s) => s.storeId === store.id)!;
    storeRule.spentToday = round2(storeRule.spentToday + amount);
    store.stats.sales++;
    step(p, "authorized", `$${amount.toFixed(2)} held on PayPal, not charged`);

    // 4. The store delivers.
    let body = "";
    let contentType = "";
    let delivered = false;
    try {
      const res = await post(`${store.storefrontUrl}/fulfil`, { productId: product.id, params: req.params ?? {}, purchaseId: p.id }, 15_000);
      body = await res.text();
      contentType = res.headers.get("content-type") ?? "";
      delivered = res.ok;
      if (!res.ok) p.reason = `store answered HTTP ${res.status}`;
    } catch {
      p.reason = "store did not deliver in time";
    }

    if (delivered) {
      p.delivery = {
        sha256: createHash("sha256").update(body).digest("hex"),
        contentType,
        bytes: Buffer.byteLength(body),
        preview: body.slice(0, 280),
      };
      step(p, "delivered", `${p.delivery.bytes} bytes, sha256 ${p.delivery.sha256.slice(0, 12)}…`);
      p.verdict = await verifyDelivery(product, body, contentType);
      step(p, p.verdict.ok ? "verified" : "rejected", `${p.verdict.by === "ai" ? "AI check" : "checks"}: ${p.verdict.reason}`);
    }

    // 5. Capture only what was verified; otherwise release the hold.
    if (delivered && p.verdict?.ok) {
      try {
        const c = await this.paypal.capture(p.paypal.authorizationId!, amount);
        p.paypal.captureId = c.captureId;
        p.status = "captured";
        store.stats.delivered++;
        store.stats.revenue = round2(store.stats.revenue + amount);
        m.totalCaptured = round2(m.totalCaptured + amount);
        step(p, "captured", `$${amount.toFixed(2)} paid to ${store.name}`);
      } catch (e) {
        p.status = "failed";
        p.reason = `capture failed: ${(e as Error).message}`;
        step(p, "failed", p.reason);
      }
    } else {
      p.reason = p.verdict?.reason ?? p.reason ?? "not delivered";
      await this.release(p, m, store);
    }

    let data: unknown = body.slice(0, 4000);
    try {
      data = JSON.parse(body);
    } catch {
      // keep text
    }
    return { purchase: p, data: p.status === "captured" ? data : undefined };
  }

  private async release(p: Purchase, m: Mandate, store: Store) {
    try {
      await this.paypal.void(p.paypal.authorizationId!);
      p.status = "voided";
      store.stats.voided++;
      m.totalVoided = round2(m.totalVoided + p.invoiceAmount);
      credit(m, store.id, p.invoiceAmount, p.createdAt);
      step(p, "voided", `hold released, nothing charged: ${p.reason}`);
    } catch (e) {
      p.status = "failed";
      step(p, "failed", `void failed: ${(e as PayPalError).message}`);
    }
  }

  /** The agent or owner rejects a captured purchase after the fact. */
  async dispute(purchaseId: string, reason: string): Promise<Purchase> {
    const p = db().purchases.find((x) => x.id === purchaseId);
    if (!p) throw new Error("unknown purchase");
    if (p.status !== "captured" || !p.paypal.captureId) throw new Error(`purchase is ${p.status}, only captured purchases can be refunded`);
    const store = findStore(p.storeId)!;
    const m = db().mandates.find((x) => x.id === p.mandateId)!;
    const r = await this.paypal.refund(p.paypal.captureId, p.invoiceAmount, `AgentTrust dispute: ${reason}`);
    p.paypal.refundId = r.refundId;
    p.status = "refunded";
    p.reason = reason;
    store.stats.refunded++;
    store.stats.delivered = Math.max(0, store.stats.delivered - 1);
    store.stats.revenue = round2(Math.max(0, store.stats.revenue - p.invoiceAmount));
    m.totalRefunded = round2(m.totalRefunded + p.invoiceAmount);
    m.totalCaptured = round2(Math.max(0, m.totalCaptured - p.invoiceAmount));
    credit(m, store.id, p.invoiceAmount, p.createdAt);
    step(p, "refunded", `$${p.invoiceAmount.toFixed(2)} refunded: ${reason}`);
    return p;
  }
}
