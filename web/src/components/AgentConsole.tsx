import { useRef, useState } from "react";
import { API, STATUS, usd, type Purchase } from "../api";

type RunEvent =
  | { type: "start"; task: string; model: string }
  | { type: "tool"; name: string; args: Record<string, unknown> }
  | { type: "step"; purchaseId: string; store: string; product: string; step: string; detail?: string }
  | { type: "purchase"; purchase: Pick<Purchase, "id" | "storeName" | "productName" | "invoiceAmount" | "status" | "reason"> }
  | { type: "answer"; text: string }
  | { type: "error"; message: string };

type Scene = { title: string; tag: string; stop: string; task?: string; attack?: true };
const SCENES: Scene[] = [
  { title: "Market brief", tag: "lookalike store", stop: "Approved stores", task: "Prepare a short market brief on Solana: current SOL price and the latest news." },
  { title: "Cheap flight", tag: "inflated invoice", stop: "Listed price", task: "Find the cheapest flight from Algiers (ALG) to Paris (CDG) today." },
  { title: "Live ticker", tag: "billing loop", stop: "Store budget", task: "Follow the live SOL price on LiveTicker for a few ticks and tell me the trend." },
  { title: "Instant quote", tag: "never delivers", stop: "PayPal hold voided", task: "Get an instant SOL quote from QuickQuote." },
  { title: "Daily digest", tag: "junk delivery", stop: "AI verification", task: "Get today's crypto digest from DailyDigest and summarise it." },
  { title: "Stolen token", tag: "no AI: attacker", stop: "Rules · Pause", attack: true },
];

const STEP_ICON: Record<string, string> = {
  quoted: "🧾",
  authorized: "⏳",
  delivered: "📦",
  verified: "🔎",
  rejected: "🔎",
  captured: "✅",
  voided: "↩️",
  blocked: "⛔",
  refunded: "↩️",
  failed: "✖",
};

export function AgentConsole({ onActivity }: { onActivity: () => void }) {
  const [task, setTask] = useState(SCENES[0].task!);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [running, setRunning] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  async function run(t = task, attack = false) {
    if (!attack) setTask(t);
    setEvents([]);
    setRunning(true);
    try {
      const res = await fetch(`${API}/api/demo/${attack ? "attack" : "run"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: t }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `server answered ${res.status}`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const e = JSON.parse(line) as RunEvent;
          setEvents((prev) => [...prev, e]);
          if (e.type === "purchase" || e.type === "step") onActivity();
          requestAnimationFrame(() => bottom.current?.scrollIntoView({ block: "nearest" }));
        }
      }
    } catch (e) {
      const msg = (e as Error).message;
      setEvents((prev) => [...prev, { type: "error", message: msg.includes("fetch") ? "Server not reachable (it may be waking up). Try again in a minute." : msg }]);
    } finally {
      setRunning(false);
      onActivity();
    }
  }

  return (
    <div className="card">
      <h3 className="font-display font-bold">AI agent console</h3>
      <p className="mt-1 text-sm text-slate-600">
        A Gemini shopping agent that trusts every store. Each scene is a way merchants or thieves go after the owner's PayPal.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {SCENES.map((s, i) => (
          <button
            key={s.title}
            disabled={running}
            onClick={() => run(s.task ?? "", s.attack)}
            className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left text-sm transition hover:border-brand hover:bg-white disabled:opacity-50"
          >
            <div className="font-semibold">
              <span className="text-slate-400">{i + 1}.</span> {s.title}
            </div>
            <div className="text-xs font-medium text-amber-700">{s.tag}</div>
            <div className="text-xs text-slate-500">Stopped by: {s.stop}</div>
          </button>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input className="input" value={task} onChange={(e) => setTask(e.target.value)} disabled={running} aria-label="Task for the agent" />
        <button className="btn-primary shrink-0" disabled={running || !task.trim()} onClick={() => run()}>
          {running ? "Running…" : "Run"}
        </button>
      </div>
      {events.length > 0 && (
        <div className="mt-4 grid max-h-[30rem] gap-1.5 overflow-y-auto rounded-xl bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-200">
          {events.map((e, i) => (
            <Line key={i} e={e} />
          ))}
          {running && <div className="animate-pulse text-slate-500">working…</div>}
          <div ref={bottom} />
        </div>
      )}
    </div>
  );
}

function Line({ e }: { e: RunEvent }) {
  switch (e.type) {
    case "start":
      return <div className="text-slate-400">▶ {e.task} <span className="text-slate-600">· {e.model}</span></div>;
    case "tool":
      return <div className="text-sky-300">→ {e.name} <span className="text-slate-500">{JSON.stringify(e.args)}</span></div>;
    case "step":
      if (["captured", "voided", "blocked", "failed", "refunded"].includes(e.step)) return null;
      return (
        <div className="pl-4 text-slate-400">
          {STEP_ICON[e.step] ?? "·"} {e.store}: {e.step}
          {e.detail && <span className="text-slate-500"> — {e.detail}</span>}
        </div>
      );
    case "purchase": {
      const s = STATUS[e.purchase.status];
      const color = e.purchase.status === "captured" ? "text-emerald-300" : e.purchase.status === "blocked" ? "text-rose-300" : "text-amber-300";
      return (
        <div className={color}>
          {s.icon} {s.label} {usd(e.purchase.invoiceAmount)} · {e.purchase.storeName}
          {e.purchase.status !== "captured" && e.purchase.reason && <span className="text-slate-400"> — {e.purchase.reason}</span>}
        </div>
      );
    }
    case "answer":
      return <div className="mt-2 whitespace-pre-wrap rounded-lg bg-white/10 p-3 font-sans text-sm text-white">{e.text}</div>;
    case "error":
      return <div className="text-rose-300">✖ {e.message}</div>;
  }
}
