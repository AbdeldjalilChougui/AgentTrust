// A policy layer over PayPal's Agent Toolkit. The toolkit gives agents tools
// that move money (create_order, pay_order, create_refund, send_invoice...).
// AgentTrust uses the same tool names and decides, per tool:
//   allow  read-only: passes straight to PayPal
//   route  moves money: only through AgentTrust's buy/dispute (rules + hold)
//   deny   owner or merchant business: never available to an agent
import { db } from "./db.js";
import type { PaymentProvider } from "./paypal.js";

export type Policy = "allow" | "route" | "deny";

export const TOOL_POLICY: { tool: string; policy: Policy; why: string }[] = [
  { tool: "get_order", policy: "allow", why: "read an order of this agent" },
  { tool: "get_refund", policy: "allow", why: "read a refund of this agent" },
  { tool: "get_shipment_tracking", policy: "allow", why: "read tracking of this agent's orders" },
  { tool: "list_disputes", policy: "allow", why: "read-only" },
  { tool: "get_dispute", policy: "allow", why: "read-only" },
  { tool: "list_transactions", policy: "allow", why: "read-only" },
  { tool: "create_order", policy: "route", why: "use buy: rules, PayPal hold, verified delivery" },
  { tool: "pay_order", policy: "route", why: "use buy: capture happens only after verification" },
  { tool: "create_refund", policy: "route", why: "use dispute: refunds this agent's captured purchase" },
  { tool: "create_subscription", policy: "route", why: "use buy: renewals re-checked against the listed price" },
  { tool: "create_invoice", policy: "deny", why: "merchant action" },
  { tool: "send_invoice", policy: "deny", why: "merchant action" },
  { tool: "cancel_sent_invoice", policy: "deny", why: "merchant action" },
  { tool: "create_product", policy: "deny", why: "merchant action" },
  { tool: "create_subscription_plan", policy: "deny", why: "merchant action" },
  { tool: "update_subscription", policy: "deny", why: "owner only" },
  { tool: "cancel_subscription", policy: "deny", why: "owner only" },
  { tool: "accept_dispute_claim", policy: "deny", why: "owner only" },
  { tool: "create_shipment_tracking", policy: "deny", why: "added by AgentTrust from the store's delivery" },
];

const policyOf = (tool: string) => TOOL_POLICY.find((t) => t.tool === tool);

/** Runs an Agent Toolkit tool for an agent, under the policy. */
export async function runPayPalTool(paypal: PaymentProvider, agentId: string, tool: string, args: Record<string, string>) {
  const rule = policyOf(tool);
  if (!rule) return { policy: "deny", error: `${tool} is not available to agents` };
  if (rule.policy !== "allow") return { policy: rule.policy, error: `${tool} is not available directly: ${rule.why}` };

  // Agents may only read their own PayPal objects.
  const mine = db().purchases.filter((p) => p.agentId === agentId);
  const owns = (id?: string) => !!id && mine.some((p) => Object.values(p.paypal).includes(id));
  switch (tool) {
    case "get_order":
      if (!owns(args.order_id)) return { policy: "allow", error: "not an order of this agent" };
      return { policy: "allow", result: await paypal.read(`/v2/checkout/orders/${encodeURIComponent(args.order_id)}`) };
    case "get_shipment_tracking": {
      if (!owns(args.order_id)) return { policy: "allow", error: "not an order of this agent" };
      const p = mine.find((x) => x.paypal.orderId === args.order_id);
      return { policy: "allow", result: { order_id: args.order_id, tracking: p?.paypal.tracking ?? null } };
    }
    case "get_refund":
      if (!owns(args.refund_id)) return { policy: "allow", error: "not a refund of this agent" };
      return { policy: "allow", result: await paypal.read(`/v2/payments/refunds/${encodeURIComponent(args.refund_id)}`) };
    case "list_disputes":
      return { policy: "allow", result: await paypal.read("/v1/customer/disputes?page_size=10") };
    case "get_dispute":
      return { policy: "allow", result: await paypal.read(`/v1/customer/disputes/${encodeURIComponent(args.dispute_id ?? "")}`) };
    case "list_transactions": {
      const end = new Date();
      const start = new Date(end.getTime() - 7 * 86_400_000);
      return {
        policy: "allow",
        result: await paypal.read(`/v1/reporting/transactions?start_date=${start.toISOString()}&end_date=${end.toISOString()}&fields=transaction_info&page_size=20`),
      };
    }
  }
  return { policy: "deny", error: "unsupported" };
}
