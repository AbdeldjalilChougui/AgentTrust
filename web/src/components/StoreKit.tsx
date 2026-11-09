import { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef } from "ag-grid-community";
import { api, gridTheme, usd, type Product, type StoreView } from "../api";

type Draft = { name: string; description: string; category: string; products: Omit<Product, "id">[] };

const EXAMPLE = `We are a small design studio in Oran. We sell:
- an icon pack of 120 line icons in SVG for 3.50
- a logo kit with 20 editable logo templates for 6 dollars
- a 30-minute brand review over video for 25`;

export function StoreKit({ refresh, onDone }: { refresh: () => void; onDone: () => void }) {
  const [name, setName] = useState("Oran Design Studio");
  const [text, setText] = useState(EXAMPLE);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [published, setPublished] = useState<StoreView | null>(null);

  const cols = useMemo<ColDef<Omit<Product, "id">>[]>(
    () => [
      { field: "name", headerName: "Product", flex: 1.2, editable: true },
      { field: "price", headerName: "Price", width: 100, editable: true, valueFormatter: (p) => usd(Number(p.value) || 0), valueParser: (p) => Number(p.newValue) || 0 },
      { field: "kind", headerName: "Kind", width: 100, editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: ["digital", "data", "service"] } },
      { field: "description", headerName: "Description", flex: 1.6, editable: true },
      { field: "deliverable", headerName: "Buyer receives (verified)", flex: 1.6, editable: true },
    ],
    [],
  );

  async function generate() {
    setBusy(true);
    setMsg("");
    setPublished(null);
    try {
      const r = await api<{ draft: Draft; by: string }>("POST", "/api/storekit/draft", { name, text });
      setDraft(r.draft);
      setBy(r.by);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!draft) return;
    setBusy(true);
    try {
      const s = await api<StoreView>("POST", "/api/storekit/publish", { draft });
      setPublished(s);
      refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
      <div className="card h-fit">
        <h2 className="font-display text-xl font-bold">Store kit</h2>
        <p className="mt-1 text-sm text-slate-600">
          Make any small shop agent-ready in a minute. Describe what you sell, in your own words or as a list; AI builds the catalog, including what each
          buyer must receive, which AgentTrust uses to verify deliveries before you get paid.
        </p>
        <label className="mt-4 block text-sm">
          <span className="label">Shop name</span>
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} />
        </label>
        <label className="mt-3 block text-sm">
          <span className="label">What do you sell?</span>
          <textarea className="input mt-1 h-48 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <button className="btn-primary mt-3 w-full" disabled={busy || !text.trim()} onClick={generate}>
          {busy && !draft ? "Building the catalog…" : "Build my catalog with AI"}
        </button>
        {msg && <p className="mt-2 text-sm text-rose-700">{msg}</p>}
      </div>

      <div className="card">
        {!draft ? (
          <div className="grid h-full place-items-center py-16 text-center text-sm text-slate-500">The catalog appears here. You can edit every cell before publishing.</div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <input
                  className="font-display w-full bg-transparent text-xl font-bold outline-none"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  aria-label="Store name"
                />
                <div className="text-sm text-slate-500">
                  {draft.category} · {draft.products.length} products · {by === "ai" ? "built by AI" : "parsed from your list"}
                </div>
              </div>
              <button className="btn-primary" disabled={busy || !!published} onClick={publish}>
                {published ? "Published" : "Publish store"}
              </button>
            </div>
            <div className="mt-4 h-[320px]">
              <AgGridReact
                theme={gridTheme}
                rowData={draft.products}
                columnDefs={cols}
                onCellValueChanged={() => setDraft({ ...draft, products: [...draft.products] })}
              />
            </div>
            {published && (
              <div className="animate-in mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                <div className="font-semibold">“{published.name}” is live and agent-ready.</div>
                <div className="mt-1">
                  Manifest:{" "}
                  <a className="font-mono text-xs underline" href={published.manifest} target="_blank">
                    {published.manifest}
                  </a>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    className="btn-primary !py-1.5 text-xs"
                    onClick={async () => {
                      await api("POST", `/api/owner/stores/${published.id}/approve`, { approved: true, dailyCap: 30 });
                      refresh();
                      onDone();
                    }}
                  >
                    Approve it for my agent
                  </button>
                  <button className="btn-ghost !py-1.5 text-xs" onClick={onDone}>
                    See the marketplace
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
