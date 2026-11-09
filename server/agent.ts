// A deliberately ordinary shopping agent: it trusts stores and buys what it is
// asked for. AgentTrust is what keeps the owner's PayPal safe.
import { db, findStore, mandateOf, reputation, type Agent, type Purchase } from "./db.js";
import { currentModel, interact, textOf } from "./gemini.js";
import { RULE_TEXT, onPurchase, type TrustEngine } from "./trust.js";
import { TOOL_POLICY, runPayPalTool } from "./paypal-tools.js";

export type RunEvent =
  | { type: "start"; task: string; model: string }
  | { type: "tool"; name: string; args: Record<string, unknown> }
  | { type: "step"; purchaseId: string; store: string; product: string; step: string; detail?: string }
  | { type: "purchase"; purchase: PurchaseSummary }
  | { type: "answer"; text: string }
  | { type: "error"; message: string };
export type Emit = (e: RunEvent) => void;

export type PurchaseSummary = Pick<Purchase, "id" | "storeName" | "productName" | "invoiceAmount" | "listedPrice" | "status" | "rule" | "reason" | "paypal" | "verdict">;
export const summarize = (p: Purchase): PurchaseSummary => ({
  id: p.id,
  storeName: p.storeName,
  productName: p.productName,
  invoiceAmount: p.invoiceAmount,
  listedPrice: p.listedPrice,
  status: p.status,
  rule: p.rule,
  reason: p.reason,
  paypal: p.paypal,
  verdict: p.verdict,
});

const MAX_TURNS = 10;
const MAX_RENEWALS = 4;

/** What any client (Gemini here, MCP for others) can do with an agent token. */
export function agentTools(engine: TrustEngine, agent: Agent) {
  return {
    searchStores(query = "") {
      const q = query.toLowerCase();
      const words = q.split(/\W+/).filter((w) => w.length > 2);
      return db()
        .stores.filter((s) => !words.length || words.some((w) => `${s.name} ${s.description} ${s.category} ${s.products.map((p) => p.name).join(" ")}`.toLowerCase().includes(w)))
        .map((s) => {
          const rep = reputation(s);
          return {
            store: s.slug,
            name: s.name,
            description: s.description,
            reputation: rep === null ? "new store" : `${Math.round(rep * 100)}% delivered`,
            products: s.products.map((p) => ({ product_id: p.id, name: p.name, price_usd: p.price, description: p.description })),
          };
        });
    },
    async buy(store: string, productId?: string, params?: Record<string, string>) {
      const results = [];
      let data: unknown;
      // A naive client pays renewals as soon as the store says one is due.
      for (let n = 0; n < MAX_RENEWALS; n++) {
        const r = await engine.buy(agent, { store, productId, params });
        results.push(summarize(r.purchase));
        data = r.data;
        if (r.purchase.status !== "captured" || (r.data as { renewal_due?: boolean } | undefined)?.renewal_due !== true) break;
      }
      return { purchases: results.map((p) => ({ store: p.storeName, product: p.productName, amount_usd: p.invoiceAmount, outcome: p.status, ...(p.reason ? { reason: p.reason } : {}) })), data };
    },
    budget() {
      const m = mandateOf(agent.id);
      if (!m) return { error: "no mandate" };
      return {
        paused: m.paused || agent.paused,
        per_purchase_cap_usd: m.perPurchaseCap,
        daily_limit_usd: m.dailyLimit,
        spent_today_usd: m.spentToday,
        left_today_usd: Math.max(0, m.dailyLimit - m.spentToday),
        allowed_categories: m.categories,
        approved_stores: m.stores.map((r) => ({ store: findStore(r.storeId)?.name, daily_budget_usd: r.dailyCap || null, spent_today_usd: r.spentToday })),
      };
    },
    myPurchases(limit = 10) {
      return db().purchases.filter((p) => p.agentId === agent.id).slice(0, limit).map(summarize);
    },
    async dispute(purchaseId: string, reason: string) {
      const p = db().purchases.find((x) => x.id === purchaseId && x.agentId === agent.id);
      if (!p) throw new Error("unknown purchase");
      return summarize(await engine.dispute(purchaseId, reason));
    },
    /** PayPal Agent Toolkit tools, under AgentTrust's policy. */
    paypal(tool: string, args: Record<string, string> = {}) {
      return runPayPalTool(engine.paypal, agent.id, tool, args);
    },
  };
}

const SYSTEM = `You are a personal shopping assistant. Your owner pays with PayPal through AgentTrust.
Complete the user's task end-to-end without asking for confirmation.
Find stores with search_stores, then buy with buy (store, product_id, and params when useful, e.g. {"check_in":"2026-11-20","check_out":"2026-11-21","guest":"Sam"}).
Prefer the cheapest store that sells what you need.
If a purchase is blocked or voided, try one other suitable store, then answer with what you have.
You can check orders, refunds and tracking with the paypal tool (PayPal Agent Toolkit tools, read-only).
When done, answer concisely in plain text: what you bought, what was charged, and what was blocked or voided and why.`;

const DECLS = [
  {
    type: "function",
    name: "search_stores",
    description: "Search agent-ready stores. Returns products with product_id and price.",
    parameters: { type: "object", properties: { query: { type: "string" } } },
  },
  {
    type: "function",
    name: "buy",
    description: "Buy a product. Payment is handled by your owner's PayPal; returns the outcome and the delivered data.",
    parameters: {
      type: "object",
      properties: {
        store: { type: "string", description: "store id from search_stores" },
        product_id: { type: "string" },
        params: { type: "object", description: "product parameters, e.g. {\"check_in\":\"2026-11-20\",\"guest\":\"Sam\"}" },
      },
      required: ["store", "product_id"],
    },
  },
  { type: "function", name: "budget_status", description: "Your owner's spending rules and what is left today.", parameters: { type: "object", properties: {} } },
  {
    type: "function",
    name: "paypal",
    description: `Run a PayPal Agent Toolkit tool. Read-only tools are allowed: ${TOOL_POLICY.filter((t) => t.policy === "allow").map((t) => t.tool).join(", ")}.`,
    parameters: {
      type: "object",
      properties: { tool: { type: "string" }, args: { type: "object", description: "e.g. {\"order_id\":\"...\"}" } },
      required: ["tool"],
    },
  },
];

function stepRelay(agent: Agent, emit: Emit) {
  return onPurchase((p, step) => {
    if (p.agentId !== agent.id) return;
    const last = p.timeline.at(-1);
    emit({ type: "step", purchaseId: p.id, store: p.storeName, product: p.productName, step, detail: last?.detail });
    if (["captured", "voided", "blocked", "failed", "refunded"].includes(step)) emit({ type: "purchase", purchase: summarize(p) });
  });
}

export async function runAgent(engine: TrustEngine, agent: Agent, task: string, emit: Emit) {
  const tools = agentTools(engine, agent);
  const stop = stepRelay(agent, emit);
  emit({ type: "start", task, model: currentModel() });
  try {
    let input: unknown = task;
    let previous: string | undefined;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const r = await interact({
        system_instruction: `${SYSTEM}\nToday is ${new Date().toISOString().slice(0, 10)}.`,
        tools: DECLS,
        generation_config: { thinking_level: "minimal" },
        input,
        ...(previous ? { previous_interaction_id: previous } : {}),
      });
      previous = r.id;
      const calls = (r.steps ?? []).filter((s) => s.type === "function_call");
      if (!calls.length) {
        emit({ type: "answer", text: textOf(r.steps) });
        return;
      }
      const results = [];
      for (const call of calls) {
        const args = call.arguments ?? {};
        emit({ type: "tool", name: call.name!, args });
        let result: unknown;
        try {
          if (call.name === "search_stores") result = tools.searchStores(String(args.query ?? ""));
          else if (call.name === "buy") result = await tools.buy(String(args.store), args.product_id ? String(args.product_id) : undefined, (args.params ?? {}) as Record<string, string>);
          else if (call.name === "budget_status") result = tools.budget();
          else if (call.name === "paypal") result = await tools.paypal(String(args.tool), (args.args ?? {}) as Record<string, string>);
          else result = { error: `unknown tool ${call.name}` };
        } catch (e) {
          result = { error: (e as Error).message };
        }
        results.push({ type: "function_result", call_id: call.id, name: call.name, result: JSON.stringify(result).slice(0, 6000) });
      }
      input = results;
    }
    emit({ type: "answer", text: "Stopped: too many steps." });
  } finally {
    stop();
  }
}

/**
 * Stolen-token scene, no AI: someone holding the agent's token tries to turn
 * the owner's PayPal into cash.
 */
export async function runAttack(engine: TrustEngine, agent: Agent, emit: Emit) {
  const tools = agentTools(engine, agent);
  const stop = stepRelay(agent, emit);
  emit({ type: "start", task: "Attacker with the stolen agent token tries to cash out the owner's PayPal", model: "no AI: direct API calls" });
  const outcomes: string[] = [];
  try {
    for (const [store, product, how] of [
      ["gifthub", "gifthub-1", "buy a $100 gift card (as good as cash)"],
      ["staywel", "staywel-1", "book through a lookalike hotel site"],
      ["grandplaza", "grandplaza-1", "push a 4x invoice through an approved hotel"],
    ] as const) {
      emit({ type: "tool", name: "steal", args: { how, store } });
      const r = await tools.buy(store, product);
      outcomes.push(r.purchases[0]?.outcome ?? "failed");
    }
    // Straight to PayPal's money-moving tools, around AgentTrust.
    for (const tool of ["pay_order", "create_refund", "send_invoice"]) {
      emit({ type: "tool", name: "steal", args: { how: `call PayPal Agent Toolkit tool ${tool} directly` } });
      const r = (await tools.paypal(tool, {})) as { policy: string; error?: string };
      emit({
        type: "purchase",
        purchase: { id: "-", storeName: "PayPal Agent Toolkit", productName: tool, invoiceAmount: 0, listedPrice: 0, status: "blocked", rule: r.policy, reason: r.error, paypal: {} },
      });
      outcomes.push("blocked");
    }
    emit({ type: "tool", name: "steal", args: { how: "raise the daily limit to $10,000 with the agent token" } });
    emit({
      type: "purchase",
      purchase: { id: "-", storeName: "Owner API", productName: "change limits", invoiceAmount: 10_000, listedPrice: 0, status: "blocked", rule: "OwnerOnly", reason: "Agent tokens cannot change rules: owner API refused (403)", paypal: {} },
    });
    outcomes.push("blocked");
    const blocked = outcomes.filter((o) => o === "blocked").length;
    const paused = mandateOf(agent.id)?.paused;
    emit({
      type: "answer",
      text: `${blocked}/${outcomes.length} theft attempts blocked before PayPal was touched. ` +
        (paused
          ? "The owner paused spending, so the token is useless."
          : "A stolen agent token can only buy approved products, at listed prices, inside daily budgets, and stores are paid only for verified deliveries. The owner can pause everything with one click."),
    });
  } finally {
    stop();
  }
}

export { RULE_TEXT };
