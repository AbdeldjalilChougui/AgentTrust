// Small JSON-backed store. All state is also recoverable from PayPal's
// records; the file only keeps the demo snappy across restarts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { DATA_FILE } from "./env.js";

export type PayPalLink = { status: "none" | "pending" | "connected"; setupTokenId?: string; paymentTokenId?: string; payerEmail?: string; connectedAt?: string };

export type Owner = { id: string; name: string; paypal: PayPalLink };

export type StoreRule = { storeId: string; dailyCap: number; spentToday: number };

/** What one agent may spend on the owner's PayPal. */
export type Mandate = {
  id: string;
  ownerId: string;
  agentId: string;
  perPurchaseCap: number;
  dailyLimit: number;
  spentToday: number;
  dayStart: string;
  categories: string[];
  minReputation: number;
  stores: StoreRule[];
  paused: boolean;
  totalCaptured: number;
  totalVoided: number;
  totalRefunded: number;
};

export type Agent = { id: string; ownerId: string; name: string; token: string; paused: boolean; createdAt: string };

export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  /** What the buyer must receive: used to verify the delivery. */
  deliverable: string;
  kind: "data" | "digital" | "service";
};

export type Behavior = "honest" | "overcharge" | "stream" | "ghost" | "junk";

export type Store = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  /** Storefront base URL implementing /catalog, /quote, /fulfil. */
  storefrontUrl: string;
  payeeEmail?: string;
  products: Product[];
  behavior: Behavior;
  createdBy: "demo" | "store-kit";
  createdAt: string;
  stats: { sales: number; delivered: number; voided: number; refunded: number; revenue: number };
};

export type Step = { at: string; step: string; detail?: string };

export type PurchaseStatus = "blocked" | "authorized" | "captured" | "voided" | "refunded" | "failed";

export type Purchase = {
  id: string;
  ownerId: string;
  mandateId: string;
  agentId: string;
  storeId: string;
  storeName: string;
  productId: string;
  productName: string;
  listedPrice: number;
  invoiceAmount: number;
  status: PurchaseStatus;
  rule?: string;
  reason?: string;
  paypal: { orderId?: string; authorizationId?: string; captureId?: string; refundId?: string };
  delivery?: { sha256: string; contentType: string; bytes: number; preview: string };
  verdict?: { ok: boolean; by: "checks" | "ai"; reason: string };
  createdAt: string;
  updatedAt: string;
  timeline: Step[];
};

type State = { owners: Owner[]; agents: Agent[]; mandates: Mandate[]; stores: Store[]; purchases: Purchase[] };

const empty = (): State => ({ owners: [], agents: [], mandates: [], stores: [], purchases: [] });

let state: State = empty();
let saveTimer: NodeJS.Timeout | null = null;

export function load() {
  if (existsSync(DATA_FILE)) state = { ...empty(), ...JSON.parse(readFileSync(DATA_FILE, "utf8")) };
  return state;
}

export function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(state, null, 1));
  }, 200);
}

export const db = () => state;
export const now = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`;
export const newToken = () => `at_${randomBytes(18).toString("base64url")}`;
export const round2 = (n: number) => Math.round(n * 100) / 100;

export const findStore = (id: string) => state.stores.find((s) => s.id === id || s.slug === id);
export const findAgentByToken = (token: string) => state.agents.find((a) => a.token === token);
export const mandateOf = (agentId: string) => state.mandates.find((m) => m.agentId === agentId);
export const ownerOf = (id: string) => state.owners.find((o) => o.id === id);

/** Share of finished sales the store delivered without void or refund. */
export function reputation(s: Store) {
  const done = s.stats.delivered + s.stats.voided + s.stats.refunded;
  return done === 0 ? null : s.stats.delivered / done;
}
