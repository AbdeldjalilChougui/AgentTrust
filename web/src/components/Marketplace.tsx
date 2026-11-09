import { useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { api, gridTheme, usd, type StoreView } from "../api";

export function Marketplace({ stores, refresh }: { stores: StoreView[]; refresh: () => void }) {
  const cols = useMemo<ColDef<StoreView>[]>(
    () => [
      {
        headerName: "Store",
        field: "name",
        flex: 1.3,
        minWidth: 200,
        filter: true,
        cellRenderer: (p: ICellRendererParams<StoreView>) => (
          <div className="leading-tight">
            <div className="font-semibold">{p.data?.name}</div>
            <div className="truncate text-xs text-slate-500">{p.data?.description}</div>
          </div>
        ),
      },
      { headerName: "Category", field: "category", width: 110, filter: true },
      { headerName: "Products", width: 100, valueGetter: (p) => p.data?.products.length ?? 0 },
      { headerName: "From", width: 90, valueGetter: (p) => Math.min(...(p.data?.products.map((x) => x.price) ?? [0])), valueFormatter: (p) => usd(p.value) },
      { headerName: "Sales", field: "stats.sales", width: 80 },
      { headerName: "Paid", field: "stats.delivered", width: 80, cellClass: "text-emerald-700 font-semibold" },
      { headerName: "Voided", field: "stats.voided", width: 85, cellClass: "text-amber-700 font-semibold" },
      { headerName: "Refunded", field: "stats.refunded", width: 95, cellClass: "text-violet-700 font-semibold" },
      {
        headerName: "Reputation",
        field: "reputation",
        width: 115,
        sort: "desc",
        comparator: (a, b) => (a ?? -1) - (b ?? -1),
        cellRenderer: (p: ICellRendererParams<StoreView>) => {
          const r = p.value as number | null;
          if (r === null) return <span className="text-slate-400">new</span>;
          const cls = r >= 0.9 ? "text-emerald-700" : r >= 0.5 ? "text-amber-700" : "text-rose-700";
          return <span className={`font-semibold ${cls}`}>{Math.round(r * 100)}%</span>;
        },
      },
      { headerName: "Revenue", field: "stats.revenue", width: 100, valueFormatter: (p) => usd(p.value ?? 0) },
      {
        headerName: "My agent",
        width: 130,
        cellRenderer: (p: ICellRendererParams<StoreView>) =>
          p.data ? (
            <button
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${p.data.approved ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              onClick={async () => {
                await api("POST", `/api/owner/stores/${p.data!.id}/approve`, { approved: !p.data!.approved, dailyCap: 10 });
                refresh();
              }}
            >
              {p.data.approved ? "✓ Approved" : "Approve"}
            </button>
          ) : null,
      },
      {
        headerName: "Daily budget",
        field: "dailyCap",
        width: 120,
        editable: (p) => !!p.data?.approved,
        valueFormatter: (p) => (p.data?.approved ? (p.value ? usd(p.value) : "no cap") : "—"),
        valueParser: (p) => Number(p.newValue) || 0,
      },
    ],
    [refresh],
  );

  return (
    <div className="grid gap-5">
      <div className="card">
        <h2 className="font-display text-xl font-bold">Agent-ready marketplace</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Stores that AI agents can buy from with PayPal. Reputation is earned, not claimed: it counts deliveries that were verified and paid,
          holds that were voided, and purchases that were refunded. Owners decide which stores their agents may pay, and set a daily budget for each
          (double-click the budget to edit).
        </p>
        <div className="mt-4 h-[560px]">
          <AgGridReact<StoreView>
            theme={gridTheme}
            rowData={stores}
            columnDefs={cols}
            getRowId={(p) => p.data.id}
            rowHeight={56}
            onCellValueChanged={async (e) => {
              if (e.colDef.field === "dailyCap" && e.data) {
                await api("POST", `/api/owner/stores/${e.data.id}/approve`, { approved: true, dailyCap: e.newValue });
                refresh();
              }
            }}
          />
        </div>
      </div>
      <div className="card text-sm text-slate-600">
        <h3 className="font-display font-bold text-ink">The storefront protocol</h3>
        <p className="mt-1">
          Every store answers four calls, so any shop can become agent-ready: <code>GET /agent-store.json</code> (manifest), <code>GET /catalog</code>,{" "}
          <code>POST /quote</code> and <code>POST /fulfil</code>. AgentTrust compares the quote with the listed price, holds the money on PayPal, asks the
          store to fulfil, verifies the delivery, then captures or voids.
        </p>
      </div>
    </div>
  );
}
