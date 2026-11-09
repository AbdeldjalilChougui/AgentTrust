import { useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { API, STATUS, ago, api, gridTheme, usd, type AppState, type Purchase, type StoreView } from "../api";
import { AgentConsole } from "./AgentConsole";

export function Dashboard({ state, stores, purchases, refresh }: { state: AppState; stores: StoreView[]; purchases: Purchase[]; refresh: () => void }) {
  const m = state.mandate;
  const [selected, setSelected] = useState<Purchase | null>(null);
  const totals = useMemo(() => {
    const sum = (s: Purchase["status"]) => purchases.filter((p) => p.status === s).reduce((a, p) => a + p.invoiceAmount, 0);
    return { paid: sum("captured"), voided: sum("voided"), blocked: sum("blocked"), refunded: sum("refunded"), count: purchases.length };
  }, [purchases]);

  return (
    <div className="grid gap-5">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Paid to stores" value={usd(totals.paid)} hint="captured after verified delivery" tone="text-emerald-700" />
        <Stat label="Never charged" value={usd(totals.voided + totals.blocked)} hint="blocked by rules or voided holds" tone="text-amber-700" />
        <Stat label="Refunded" value={usd(totals.refunded)} hint="disputed after capture" tone="text-violet-700" />
        <Stat label="Spent today" value={`${usd(m.spentToday)} / ${usd(m.dailyLimit)}`} hint={m.paused ? "PAUSED by owner" : `${totals.count} purchase attempts`} tone={m.paused ? "text-rose-700" : "text-ink"} />
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <AgentConsole onActivity={refresh} />
        <div className="grid content-start gap-5">
          <PayPalCard state={state} refresh={refresh} />
          <RulesCard state={state} stores={stores} refresh={refresh} />
        </div>
      </section>

      <PurchasesGrid purchases={purchases} onSelect={setSelected} refresh={refresh} />
      {selected && <PurchaseDetail p={purchases.find((x) => x.id === selected.id) ?? selected} onClose={() => setSelected(null)} />}
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <ToolPolicy />
        <McpCard token={state.agent.token} />
      </section>
    </div>
  );
}

type ToolRule = { tool: string; policy: "allow" | "route" | "deny"; why: string };
const POLICY_STYLE: Record<ToolRule["policy"], string> = {
  allow: "bg-emerald-100 text-emerald-800",
  route: "bg-sky-100 text-sky-800",
  deny: "bg-rose-100 text-rose-800",
};

/** How AgentTrust treats each PayPal Agent Toolkit tool an agent might call. */
function ToolPolicy() {
  const [rows, setRows] = useState<ToolRule[]>([]);
  useEffect(() => {
    api<ToolRule[]>("GET", "/api/paypal-tools").then(setRows).catch(() => {});
  }, []);
  const cols = useMemo<ColDef<ToolRule>[]>(
    () => [
      { headerName: "PayPal Agent Toolkit tool", field: "tool", flex: 1.1, cellClass: "font-mono text-xs", filter: true },
      {
        headerName: "AgentTrust",
        field: "policy",
        width: 120,
        filter: true,
        cellRenderer: (p: ICellRendererParams<ToolRule>) =>
          p.data ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${POLICY_STYLE[p.data.policy]}`}>{p.data.policy}</span> : null,
      },
      { headerName: "Why", field: "why", flex: 1.6 },
    ],
    [],
  );
  return (
    <div className="card">
      <h3 className="font-display font-bold">PayPal Agent Toolkit, with a firewall</h3>
      <p className="mt-1 text-sm text-slate-600">
        Agents may use PayPal's own toolkit tools. Read-only tools pass straight through; anything that moves money is routed through the owner's
        rules and the PayPal hold; merchant and owner actions are denied.
      </p>
      <div className="mt-3 h-[300px]">
        <AgGridReact<ToolRule> theme={gridTheme} rowData={rows} columnDefs={cols} getRowId={(p) => p.data.tool} />
      </div>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: string }) {
  return (
    <div className="card !p-4">
      <div className="label">{label}</div>
      <div className={`mt-1 font-display text-2xl font-bold ${tone}`}>{value}</div>
      <div className="text-xs text-slate-500">{hint}</div>
    </div>
  );
}

function PayPalCard({ state, refresh }: { state: AppState; refresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pp = state.owner.paypal;
  async function connect() {
    setBusy(true);
    setErr("");
    try {
      const { approveUrl } = await api<{ approveUrl: string }>("POST", "/api/owner/paypal/connect", { webUrl: location.origin });
      location.href = approveUrl;
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
      refresh();
    }
  }
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-bold">Owner's PayPal</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${pp.status === "connected" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
          {pp.status === "connected" ? "Connected" : pp.status === "pending" ? "Waiting for approval" : "Not connected"}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        {pp.status === "connected"
          ? `Approved once${pp.payerEmail ? ` by ${pp.payerEmail}` : ""}. Each agent purchase is held on PayPal and captured only after delivery is verified.`
          : "Approve AgentTrust once. Your agent then buys without a checkout window, but only inside your rules."}
      </p>
      <button className="btn-primary mt-3 w-full" disabled={busy} onClick={connect}>
        {busy ? "Opening PayPal…" : pp.status === "connected" ? "Reconnect PayPal" : "Connect PayPal"}
      </button>
      {err && <p className="mt-2 text-sm text-rose-700">{err}</p>}
    </div>
  );
}

function RulesCard({ state, stores, refresh }: { state: AppState; stores: StoreView[]; refresh: () => void }) {
  const m = state.mandate;
  const [cap, setCap] = useState(String(m.perPurchaseCap));
  const [daily, setDaily] = useState(String(m.dailyLimit));
  const [msg, setMsg] = useState("");
  const pct = Math.min(100, (m.spentToday / Math.max(m.dailyLimit, 0.01)) * 100);
  const approved = stores.filter((s) => s.approved);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      setMsg(done);
      refresh();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-bold">Rules for “{state.agent.name}”</h3>
        <button
          className={m.paused ? "btn-primary !py-1 text-xs" : "btn-danger !py-1 text-xs"}
          onClick={() => act(() => api("POST", "/api/owner/pause", { paused: !m.paused }), m.paused ? "Spending resumed." : "All agent spending paused.")}
        >
          {m.paused ? "Resume" : "⏸ Pause all"}
        </button>
      </div>
      <div className="mt-3 flex justify-between text-sm">
        <span>Spent today</span>
        <span className="font-semibold">
          {usd(m.spentToday)} / {usd(m.dailyLimit)}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${pct >= 100 ? "bg-rose-500" : "bg-gradient-to-r from-brand to-trust"}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <label className="text-sm">
          <span className="label">Per purchase</span>
          <input className="input mt-1" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="label">Daily limit</span>
          <input className="input mt-1" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} />
        </label>
      </div>
      <div className="mt-2 flex gap-2">
        <button className="btn-ghost flex-1" onClick={() => act(() => api("PUT", "/api/owner/mandate", { perPurchaseCap: Number(cap), dailyLimit: Number(daily) }), "Limits saved.")}>
          Save limits
        </button>
        <button className="btn-ghost flex-1" onClick={() => act(() => api("POST", "/api/owner/reset"), "Today's budgets reset.")}>
          Reset today
        </button>
      </div>
      <div className="label mt-4">Allowed categories</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {m.categories.map((c) => (
          <span key={c} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">{c}</span>
        ))}
      </div>
      <div className="label mt-4">Approved stores ({approved.length})</div>
      <ul className="mt-1 grid gap-1.5 text-sm">
        {approved.map((s) => (
          <li key={s.id}>
            <div className="flex justify-between">
              <span>{s.name}</span>
              <span className="text-slate-500">{usd(s.spentToday)} / {s.dailyCap ? usd(s.dailyCap) : "no cap"}</span>
            </div>
            {s.dailyCap > 0 && (
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand/70" style={{ width: `${Math.min(100, (s.spentToday / s.dailyCap) * 100)}%` }} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {msg && <p className="mt-3 text-sm text-slate-600">{msg}</p>}
    </div>
  );
}

function StatusCell(p: ICellRendererParams<Purchase>) {
  const s = p.data ? STATUS[p.data.status] : null;
  return s ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>{s.icon} {s.label}</span> : null;
}

function PurchasesGrid({ purchases, onSelect, refresh }: { purchases: Purchase[]; onSelect: (p: Purchase) => void; refresh: () => void }) {
  const cols = useMemo<ColDef<Purchase>[]>(
    () => [
      { headerName: "When", field: "createdAt", width: 100, valueFormatter: (p) => ago(p.value), sort: "desc" },
      { headerName: "Status", field: "status", width: 120, cellRenderer: StatusCell, filter: true },
      { headerName: "Store", field: "storeName", width: 150, filter: true },
      { headerName: "Product", field: "productName", flex: 1, minWidth: 160 },
      { headerName: "Invoice", field: "invoiceAmount", width: 100, valueFormatter: (p) => usd(p.value ?? 0), cellClass: "font-semibold" },
      { headerName: "Listed", field: "listedPrice", width: 90, valueFormatter: (p) => usd(p.value ?? 0) },
      {
        headerName: "Why",
        flex: 1.4,
        minWidth: 220,
        valueGetter: (p) => p.data?.reason ?? p.data?.verdict?.reason ?? "",
        tooltipValueGetter: (p) => p.value,
      },
      { headerName: "PayPal authorization", width: 200, valueGetter: (p) => p.data?.paypal.authorizationId ?? "—", cellClass: "font-mono text-xs" },
      {
        headerName: "",
        width: 110,
        pinned: "right",
        sortable: false,
        cellRenderer: (p: ICellRendererParams<Purchase>) =>
          p.data?.status === "captured" ? (
            <button
              className="text-xs font-semibold text-violet-700 hover:underline"
              onClick={async (e) => {
                e.stopPropagation();
                await api("POST", `/api/purchases/${p.data!.id}/refund`, { reason: "owner dispute" }).catch(() => {});
                refresh();
              }}
            >
              Refund
            </button>
          ) : null,
      },
    ],
    [refresh],
  );
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-bold">Purchases</h3>
        <span className="text-xs text-slate-500">Click a row for its timeline · live</span>
      </div>
      <div className="mt-3 h-[420px]">
        <AgGridReact<Purchase>
          theme={gridTheme}
          rowData={purchases}
          columnDefs={cols}
          getRowId={(p) => p.data.id}
          onRowClicked={(e) => e.data && onSelect(e.data)}
          animateRows
          tooltipShowDelay={300}
          overlayNoRowsTemplate="No purchases yet. Run a scene above."
        />
      </div>
    </div>
  );
}

function PurchaseDetail({ p, onClose }: { p: Purchase; onClose: () => void }) {
  const s = STATUS[p.status];
  return (
    <div className="card animate-in">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display font-bold">{p.storeName}: {p.productName}</h3>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>{s.icon} {s.label}</span>
          </div>
          <div className="text-sm text-slate-500">
            Invoice {usd(p.invoiceAmount)} · listed {usd(p.listedPrice)} · {p.id}
          </div>
        </div>
        <button className="btn-ghost !py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      <ol className="mt-4 grid gap-2 border-l-2 border-slate-200 pl-4">
        {p.timeline.map((t, i) => (
          <li key={i} className="text-sm">
            <span className="font-semibold capitalize">{t.step}</span> <span className="text-slate-400">{new Date(t.at).toLocaleTimeString()}</span>
            {t.detail && <div className="text-slate-600">{t.detail}</div>}
          </li>
        ))}
      </ol>
      <div className="mt-4 grid gap-1 font-mono text-xs text-slate-500">
        {p.paypal.orderId && <div>PayPal order {p.paypal.orderId}</div>}
        {p.paypal.authorizationId && <div>authorization {p.paypal.authorizationId}</div>}
        {p.paypal.captureId && <div>capture {p.paypal.captureId}</div>}
        {p.paypal.refundId && <div>refund {p.paypal.refundId}</div>}
        {p.delivery && <div>delivery sha256 {p.delivery.sha256}</div>}
      </div>
      {p.delivery && <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{p.delivery.preview}</pre>}
    </div>
  );
}

function McpCard({ token }: { token: string }) {
  const [show, setShow] = useState(false);
  const cmd = `claude mcp add agenttrust -e AGENTTRUST_URL=${API} -e AGENTTRUST_TOKEN=${show ? token : "at_••••"} -- pnpm --dir AgentTrust mcp`;
  return (
    <div className="card">
      <h3 className="font-display font-bold">Use it from any AI agent</h3>
      <p className="mt-1 text-sm text-slate-600">
        AgentTrust is an MCP server too. Claude, Cursor or any MCP client gets <code>search_stores</code>, <code>buy</code>, <code>budget_status</code>,{" "}
        <code>my_purchases</code> and <code>dispute</code>, and every purchase still goes through these rules and the PayPal hold. Plain HTTP works as well:{" "}
        <code>POST {API}/agent/v1/buy</code> with the agent token.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-100">{cmd}</code>
        <button className="btn-ghost !py-1.5 text-xs" onClick={() => setShow(!show)}>{show ? "Hide token" : "Show token"}</button>
      </div>
    </div>
  );
}
