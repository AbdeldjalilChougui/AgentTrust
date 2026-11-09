import { useCallback, useEffect, useState } from "react";
import { api, type AppState, type Purchase, type StoreView } from "./api";
import { Dashboard } from "./components/Dashboard";
import { Marketplace } from "./components/Marketplace";
import { StoreKit } from "./components/StoreKit";

type Tab = "dashboard" | "market" | "storekit";
const readTab = (): Tab => {
  const t = new URLSearchParams(location.search).get("tab");
  return t === "market" || t === "storekit" ? t : "dashboard";
};

export default function App() {
  const [tab, setTab] = useState<Tab>(readTab);
  const [state, setState] = useState<AppState | null>(null);
  const [stores, setStores] = useState<StoreView[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState(() => {
    const p = new URLSearchParams(location.search).get("paypal");
    return p === "connected" ? "PayPal connected. Your agent can now buy inside your rules." : p === "error" ? `PayPal connection failed: ${new URLSearchParams(location.search).get("reason") ?? ""}` : "";
  });

  const refresh = useCallback(async () => {
    try {
      const [s, st, p] = await Promise.all([api<AppState>("GET", "/api/state"), api<StoreView[]>("GET", "/api/stores"), api<Purchase[]>("GET", "/api/purchases")]);
      setState(s);
      setStores(st);
      setPurchases(p);
      setError("");
    } catch (e) {
      setError((e as Error).message.includes("fetch") ? "Server not reachable. On the free Render plan it may be waking up: wait a minute." : (e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", t === "dashboard" ? location.pathname : `?tab=${t}`);
  };
  const tabCls = (t: Tab) => `rounded-lg px-3 py-1.5 text-sm font-medium transition ${tab === t ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-3 py-5">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="h-9 w-9" />
          <div>
            <div className="font-display text-lg font-bold tracking-tight">AgentTrust</div>
            <div className="text-xs text-slate-500">Safe PayPal payments for AI agents</div>
          </div>
        </div>
        <nav className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
          <button className={tabCls("dashboard")} onClick={() => go("dashboard")}>Dashboard</button>
          <button className={tabCls("market")} onClick={() => go("market")}>Marketplace</button>
          <button className={tabCls("storekit")} onClick={() => go("storekit")}>Store kit</button>
        </nav>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${state?.paypalMode === "sandbox" ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-800"}`}>
          PayPal {state?.paypalMode === "sandbox" ? "sandbox" : "mock mode"}
        </span>
      </header>

      {flash && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {flash}
          <button className="text-emerald-700" onClick={() => setFlash("")} aria-label="Dismiss">✕</button>
        </div>
      )}
      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}

      {!state ? (
        <div className="card text-slate-500">Loading…</div>
      ) : tab === "dashboard" ? (
        <Dashboard state={state} stores={stores} purchases={purchases} refresh={refresh} />
      ) : tab === "market" ? (
        <Marketplace stores={stores} refresh={refresh} />
      ) : (
        <StoreKit refresh={refresh} onDone={() => go("market")} />
      )}

      <footer className="mt-10 text-center text-xs text-slate-400">
        AgentTrust holds every agent purchase on PayPal and captures it only after the delivery is verified. Sandbox demo, no real money.
      </footer>
    </div>
  );
}
