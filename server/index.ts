// AgentTrust server: owner API, agent API, store kit, storefronts, demo runs.
import express, { type NextFunction, type Request, type Response } from "express";
import { BASE_URL, PAYPAL_MODE, PORT, WEB_URL } from "./env.js";
import { db, findAgentByToken, findStore, load, mandateOf, ownerOf, reputation, save, type Agent } from "./db.js";
import { PayPalMock, createProvider } from "./paypal.js";
import { DEMO_AGENT, DEMO_OWNER, resetDemo, seed } from "./seed.js";
import { storefrontRouter } from "./stores/storefront.js";
import { draftStore, publishStore } from "./storekit.js";
import { TrustEngine } from "./trust.js";
import { agentTools, runAgent, runAttack, summarize, type RunEvent } from "./agent.js";
import { geminiReady } from "./gemini.js";

load();
const { agent: demoAgent } = seed();
const paypal = createProvider();
const engine = new TrustEngine(paypal);

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "200kb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  if (req.method === "OPTIONS") return void res.sendStatus(204);
  next();
});

const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);

app.get("/health", (_req, res) => void res.json({ ok: true, paypal: paypal.mode }));
app.use("/stores", storefrontRouter());

// ── Owner API ────────────────────────────────────────────────────────────────
// Agent tokens are refused here: an agent can never change its own rules.
const ownerOnly = (req: Request, res: Response, next: NextFunction) => {
  if (String(req.headers.authorization ?? "").includes("at_")) return void res.status(403).json({ error: "agent tokens cannot use the owner API" });
  next();
};
const owner = () => ownerOf(DEMO_OWNER)!;
const mandate = () => mandateOf(DEMO_AGENT)!;

function storeView(s: ReturnType<typeof findStore> & object) {
  const rule = mandate().stores.find((r) => r.storeId === s.id);
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    description: s.description,
    category: s.category,
    createdBy: s.createdBy,
    products: s.products,
    stats: s.stats,
    reputation: reputation(s),
    approved: !!rule,
    dailyCap: rule?.dailyCap ?? 0,
    spentToday: rule?.spentToday ?? 0,
    manifest: `${BASE_URL}/stores/${s.slug}/agent-store.json`,
  };
}

app.get("/api/state", (_req, res) => {
  const o = owner();
  const a = db().agents.find((x) => x.id === DEMO_AGENT)!;
  res.json({
    paypalMode: paypal.mode,
    ai: geminiReady(),
    owner: { id: o.id, name: o.name, paypal: { status: o.paypal.status, payerEmail: o.paypal.payerEmail, connectedAt: o.paypal.connectedAt } },
    agent: { id: a.id, name: a.name, paused: a.paused, token: a.token, mcp: `pnpm mcp (AGENTTRUST_TOKEN=${a.token})` },
    mandate: mandate(),
  });
});

app.get("/api/stores", (_req, res) => void res.json(db().stores.map((s) => storeView(s))));
app.get("/api/purchases", (req, res) => void res.json(db().purchases.slice(0, Math.min(200, Number(req.query.limit ?? 100)))));

app.put("/api/owner/mandate", ownerOnly, (req, res) => {
  const m = mandate();
  const b = req.body ?? {};
  if (b.perPurchaseCap !== undefined) m.perPurchaseCap = Math.max(0, Number(b.perPurchaseCap));
  if (b.dailyLimit !== undefined) m.dailyLimit = Math.max(0, Number(b.dailyLimit));
  if (Array.isArray(b.categories)) m.categories = b.categories.map(String).slice(0, 12);
  if (b.minReputation !== undefined) m.minReputation = Math.min(1, Math.max(0, Number(b.minReputation)));
  save();
  res.json(m);
});

app.post("/api/owner/pause", ownerOnly, (req, res) => {
  mandate().paused = !!req.body?.paused;
  save();
  res.json({ paused: mandate().paused });
});

app.post("/api/owner/reset", ownerOnly, (_req, res) => {
  resetDemo();
  res.json({ ok: true });
});

app.post("/api/owner/stores/:id/approve", ownerOnly, (req, res) => {
  const s = findStore(String(req.params.id));
  if (!s) return void res.status(404).json({ error: "unknown store" });
  const m = mandate();
  const approve = req.body?.approved !== false;
  const existing = m.stores.find((r) => r.storeId === s.id);
  if (approve && !existing) m.stores.push({ storeId: s.id, dailyCap: Number(req.body?.dailyCap ?? 0), spentToday: 0 });
  else if (approve && existing && req.body?.dailyCap !== undefined) existing.dailyCap = Number(req.body.dailyCap);
  else if (!approve) m.stores = m.stores.filter((r) => r.storeId !== s.id);
  if (approve && !m.categories.includes(s.category) && m.categories.length) m.categories.push(s.category);
  save();
  res.json(storeView(s));
});

app.post("/api/purchases/:id/refund", ownerOnly, wrap(async (req, res) => {
  res.json(await engine.dispute(String(req.params.id), String(req.body?.reason ?? "owner dispute")));
}));

// PayPal connect: the owner approves AgentTrust once; PayPal returns a
// reusable payment token, so agents can buy without a checkout window.
app.post("/api/owner/paypal/connect", ownerOnly, wrap(async (_req, res) => {
  const t = await paypal.createSetupToken(`${BASE_URL}/api/owner/paypal/return`, `${WEB_URL}/?paypal=cancelled`);
  owner().paypal = { ...owner().paypal, status: owner().paypal.status === "connected" ? "connected" : "pending", setupTokenId: t.id };
  save();
  res.json({ approveUrl: t.approveUrl });
}));

app.get("/api/owner/paypal/return", wrap(async (req, res) => {
  const id = String(req.query.approval_token_id ?? req.query.token ?? owner().paypal.setupTokenId ?? "");
  try {
    const t = await paypal.createPaymentToken(id);
    owner().paypal = { status: "connected", paymentTokenId: t.id, payerEmail: t.payerEmail, connectedAt: new Date().toISOString() };
    save();
    console.log(`PayPal connected: payment token ${t.id}`);
    res.redirect(`${WEB_URL}/?paypal=connected`);
  } catch (e) {
    res.redirect(`${WEB_URL}/?paypal=error&reason=${encodeURIComponent((e as Error).message)}`);
  }
}));

if (paypal instanceof PayPalMock) {
  app.get("/mock-paypal/approve", (req, res) => {
    const token = String(req.query.token ?? "");
    res.send(`<!doctype html><meta name=viewport content="width=device-width"><title>Mock PayPal</title>
<body style="font-family:system-ui;background:#f5f7fa;display:grid;place-items:center;height:100vh;margin:0">
<form method=post action="/mock-paypal/approve?token=${encodeURIComponent(token)}" style="background:#fff;padding:32px;border-radius:16px;max-width:420px;box-shadow:0 4px 20px #0001">
<h2 style="color:#003087;margin-top:0">PayPal (mock)</h2>
<p>Allow <b>AgentTrust</b> to make purchases for you, inside the limits you set?</p>
<button style="background:#0070ba;color:#fff;border:0;border-radius:24px;padding:12px 28px;font-size:16px">Agree and continue</button>
<p style="color:#888;font-size:13px">Mock mode: no real PayPal account involved.</p></form>`);
  });
  app.post("/mock-paypal/approve", (req, res) => {
    const next = (paypal as PayPalMock).approveSetup(String(req.query.token ?? ""));
    if (!next) return void res.status(404).send("unknown token");
    res.redirect(next);
  });
}

// ── Store kit ────────────────────────────────────────────────────────────────
app.post("/api/storekit/draft", wrap(async (req, res) => {
  const text = String(req.body?.text ?? "").slice(0, 4000);
  if (!text.trim()) return void res.status(400).json({ error: "describe your shop or paste products" });
  res.json(await draftStore({ name: String(req.body?.name ?? ""), text }));
}));
app.post("/api/storekit/publish", wrap(async (req, res) => {
  const d = req.body?.draft;
  if (!d?.name || !Array.isArray(d.products) || !d.products.length) return void res.status(400).json({ error: "draft needs a name and products" });
  if (db().stores.filter((s) => s.createdBy === "store-kit").length >= 50) return void res.status(429).json({ error: "store limit reached for the demo" });
  res.json(storeView(publishStore(d)));
}));

// ── Agent API (Bearer agent token) ───────────────────────────────────────────
const agentAuth = (req: Request, res: Response, next: NextFunction) => {
  const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const a = findAgentByToken(token);
  if (!a) return void res.status(401).json({ error: "invalid agent token" });
  res.locals.agent = a;
  next();
};
const tools = (res: Response) => agentTools(engine, res.locals.agent as Agent);
app.get("/agent/v1/stores", agentAuth, (req, res) => void res.json(tools(res).searchStores(String(req.query.q ?? ""))));
app.get("/agent/v1/budget", agentAuth, (_req, res) => void res.json(tools(res).budget()));
app.get("/agent/v1/purchases", agentAuth, (_req, res) => void res.json(tools(res).myPurchases(20)));
app.post("/agent/v1/buy", agentAuth, wrap(async (req, res) => {
  const b = req.body ?? {};
  res.json(await tools(res).buy(String(b.store), b.product_id ? String(b.product_id) : undefined, b.params ?? {}));
}));
app.post("/agent/v1/dispute", agentAuth, wrap(async (req, res) => {
  res.json(await tools(res).dispute(String(req.body?.purchase_id), String(req.body?.reason ?? "not as described")));
}));

// ── Demo runs, streamed as NDJSON ────────────────────────────────────────────
let busy = false;
const RUNS_PER_HOUR = Number(process.env.AGENT_RUNS_PER_HOUR ?? 40);
let runWindow = { start: Date.now(), count: 0 };
async function stream(res: Response, job: (emit: (e: RunEvent) => void) => Promise<void>) {
  if (busy) return void res.status(409).json({ error: "The demo agent is busy. Try again in a moment." });
  if (Date.now() - runWindow.start > 3_600_000) runWindow = { start: Date.now(), count: 0 };
  if (runWindow.count++ >= RUNS_PER_HOUR) return void res.status(429).json({ error: "Demo run limit reached for this hour." });
  busy = true;
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();
  try {
    await job((e) => res.write(JSON.stringify(e) + "\n"));
  } catch (e) {
    res.write(JSON.stringify({ type: "error", message: (e as Error).message }) + "\n");
  } finally {
    busy = false;
    res.end();
  }
}
const agentOf = () => db().agents.find((a) => a.id === DEMO_AGENT)!;
app.post("/api/demo/run", async (req, res) => {
  const task = String(req.body?.task ?? "").slice(0, 600);
  if (!task) return void res.status(400).json({ error: "task is required" });
  await stream(res, (emit) => runAgent(engine, agentOf(), task, emit));
});
app.post("/api/demo/attack", async (_req, res) => {
  await stream(res, (emit) => runAttack(engine, agentOf(), emit));
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(502).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`AgentTrust on ${BASE_URL} · PayPal ${paypal.mode} · AI ${geminiReady() ? "on" : "off"}`);
  console.log(`demo agent token: ${demoAgent.token}`);
  if (paypal.mode === "sandbox" && owner().paypal.status !== "connected") console.log(`connect PayPal: open the web app and press "Connect PayPal"`);
});

export { summarize, PAYPAL_MODE };
