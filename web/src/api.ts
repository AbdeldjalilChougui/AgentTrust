// Typed client for the AgentTrust server.
import { themeQuartz } from "ag-grid-community";

// On Render the blueprint passes the server's bare host name.
const rawApi = (import.meta.env.VITE_API_URL || "http://localhost:4500").replace(/\/$/, "");
// Render passes the service's internal host name ("agenttrust-server"): its
// public address is the same name on onrender.com.
const host = rawApi.includes(".") || rawApi.includes("localhost") ? rawApi : `${rawApi}.onrender.com`;
export const API = /^https?:\/\//.test(host) ? host : `https://${host}`;

export type Mandate = {
  id: string;
  perPurchaseCap: number;
  dailyLimit: number;
  spentToday: number;
  categories: string[];
  minReputation: number;
  paused: boolean;
  stores: { storeId: string; dailyCap: number; spentToday: number }[];
  totalCaptured: number;
  totalVoided: number;
  totalRefunded: number;
};

export type AppState = {
  paypalMode: "mock" | "sandbox";
  ai: boolean;
  owner: { id: string; name: string; paypal: { status: "none" | "pending" | "connected"; payerEmail?: string; connectedAt?: string } };
  agent: { id: string; name: string; paused: boolean; token: string };
  mandate: Mandate;
};

export type Product = { id: string; name: string; description: string; price: number; category: string; deliverable: string; kind: string };

export type StoreView = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  createdBy: "demo" | "store-kit";
  products: Product[];
  stats: { sales: number; delivered: number; voided: number; refunded: number; revenue: number };
  reputation: number | null;
  approved: boolean;
  dailyCap: number;
  spentToday: number;
  manifest: string;
};

export type Purchase = {
  id: string;
  storeId: string;
  storeName: string;
  productName: string;
  listedPrice: number;
  invoiceAmount: number;
  status: "blocked" | "authorized" | "captured" | "voided" | "refunded" | "failed";
  rule?: string;
  reason?: string;
  paypal: { orderId?: string; authorizationId?: string; captureId?: string; refundId?: string };
  delivery?: { sha256: string; contentType: string; bytes: number; preview: string };
  verdict?: { ok: boolean; by: "checks" | "ai"; reason: string };
  createdAt: string;
  timeline: { at: string; step: string; detail?: string }[];
};

export async function api<T = any>(method: string, path: string, body?: object): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `server answered ${res.status}`);
  return json as T;
}

export const usd = (n: number) => `$${n.toFixed(2)}`;
export const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export const STATUS: Record<Purchase["status"], { label: string; cls: string; icon: string }> = {
  captured: { label: "Paid", cls: "bg-emerald-100 text-emerald-800", icon: "✓" },
  authorized: { label: "Held", cls: "bg-sky-100 text-sky-800", icon: "⏳" },
  voided: { label: "Voided", cls: "bg-amber-100 text-amber-800", icon: "↩" },
  refunded: { label: "Refunded", cls: "bg-violet-100 text-violet-800", icon: "↩" },
  blocked: { label: "Blocked", cls: "bg-rose-100 text-rose-800", icon: "⛔" },
  failed: { label: "Failed", cls: "bg-slate-200 text-slate-700", icon: "✖" },
};

export const gridTheme = themeQuartz.withParams({
  accentColor: "#2563eb",
  headerBackgroundColor: "#f8fafc",
  headerFontWeight: 600,
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: 13,
  borderColor: "#e2e8f0",
  rowHoverColor: "#f1f5ff",
  wrapperBorderRadius: 12,
});
