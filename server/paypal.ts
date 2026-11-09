// PayPal as the escrow: an agent purchase is AUTHORIZED (money held on the
// owner's PayPal), then CAPTURED only after the delivery is verified, VOIDED
// if it fails, or REFUNDED if disputed later. The owner approves PayPal once
// (a vaulted payment method), so the agent never needs a checkout window.
import { randomUUID } from "node:crypto";
import { BASE_URL, PAYPAL_MODE } from "./env.js";

export type Authorization = { orderId: string; authorizationId: string; status: string };

export interface PaymentProvider {
  readonly mode: "mock" | "sandbox";
  /** Starts the one-time approval; the owner opens approveUrl. */
  createSetupToken(returnUrl: string, cancelUrl: string): Promise<{ id: string; approveUrl: string }>;
  /** Turns an approved setup token into a reusable payment token. */
  createPaymentToken(setupTokenId: string): Promise<{ id: string; payerEmail?: string }>;
  authorize(p: {
    amount: number;
    description: string;
    referenceId: string;
    paymentTokenId: string;
    payeeEmail?: string;
  }): Promise<Authorization>;
  capture(authorizationId: string, amount: number): Promise<{ captureId: string; status: string }>;
  void(authorizationId: string): Promise<{ status: string }>;
  refund(captureId: string, amount: number, note: string): Promise<{ refundId: string; status: string }>;
  /** Shipment tracking on the order, so the payer sees it in PayPal. */
  addTracking(p: { orderId: string; captureId: string; trackingNumber: string; carrier: string }): Promise<{ id: string }>;
  /** Read-only PayPal calls exposed to agents through the tool policy. */
  read(path: string): Promise<unknown>;
  verifyWebhook(headers: Record<string, string | string[] | undefined>, event: unknown): Promise<boolean>;
}

const money = (n: number) => ({ currency_code: "USD", value: n.toFixed(2) });

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly debugId?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Real PayPal REST client (sandbox). */
export class PayPalSandbox implements PaymentProvider {
  readonly mode = "sandbox" as const;
  private base = "https://api-m.sandbox.paypal.com";
  private token: { value: string; expires: number } | null = null;

  constructor(
    private clientId: string,
    private secret: string,
  ) {}

  private async accessToken() {
    if (this.token && Date.now() < this.token.expires - 60_000) return this.token.value;
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const json = await res.json();
    if (!res.ok) throw new PayPalError(json.error_description ?? "PayPal auth failed", res.status);
    this.token = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 };
    return this.token.value;
  }

  private async call<T = any>(method: string, path: string, body?: object, requestId?: string): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const issue = json.details?.[0]?.issue ?? json.name ?? "PAYPAL_ERROR";
      throw new PayPalError(`${issue}: ${json.details?.[0]?.description ?? json.message ?? res.statusText}`, res.status, json.debug_id, json.details);
    }
    return json as T;
  }

  async createSetupToken(returnUrl: string, cancelUrl: string) {
    const r = await this.call("POST", "/v3/vault/setup-tokens", {
      payment_source: {
        paypal: {
          usage_type: "MERCHANT",
          usage_pattern: "UNSCHEDULED_POSTPAID",
          description: "AgentTrust: purchases by your AI agent, inside your limits",
          experience_context: {
            brand_name: "AgentTrust",
            return_url: returnUrl,
            cancel_url: cancelUrl,
            shipping_preference: "NO_SHIPPING",
            vault_instruction: "ON_PAYER_APPROVAL",
          },
        },
      },
    }, randomUUID());
    const approve = r.links?.find((l: { rel: string }) => l.rel === "approve")?.href;
    if (!approve) throw new PayPalError("No approve link in setup token", 500);
    return { id: r.id as string, approveUrl: approve as string };
  }

  async createPaymentToken(setupTokenId: string) {
    const r = await this.call("POST", "/v3/vault/payment-tokens", {
      payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } },
    }, randomUUID());
    return { id: r.id as string, payerEmail: r.payment_source?.paypal?.email_address as string | undefined };
  }

  async authorize(p: { amount: number; description: string; referenceId: string; paymentTokenId: string; payeeEmail?: string }) {
    const order = await this.call("POST", "/v2/checkout/orders", {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: p.referenceId,
          custom_id: p.referenceId,
          description: p.description.slice(0, 127),
          amount: money(p.amount),
          ...(p.payeeEmail ? { payee: { email_address: p.payeeEmail } } : {}),
        },
      ],
      payment_source: { paypal: { vault_id: p.paymentTokenId } },
    }, `auth-${p.referenceId}`);
    let o = order;
    // With a vaulted token PayPal usually completes the authorization at once;
    // otherwise the order is approved and needs an explicit authorize call.
    if (o.status !== "COMPLETED") o = await this.call("POST", `/v2/checkout/orders/${o.id}/authorize`, {}, `auth2-${p.referenceId}`);
    const auth = o.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!auth?.id) throw new PayPalError(`Order ${o.id} has no authorization (status ${o.status})`, 500);
    return { orderId: o.id as string, authorizationId: auth.id as string, status: auth.status as string };
  }

  async capture(authorizationId: string, amount: number) {
    const r = await this.call("POST", `/v2/payments/authorizations/${authorizationId}/capture`, {
      amount: money(amount),
      final_capture: true,
    }, `cap-${authorizationId}`);
    return { captureId: r.id as string, status: r.status as string };
  }

  async void(authorizationId: string) {
    await this.call("POST", `/v2/payments/authorizations/${authorizationId}/void`, undefined, `void-${authorizationId}`);
    return { status: "VOIDED" };
  }

  async refund(captureId: string, amount: number, note: string) {
    const r = await this.call("POST", `/v2/payments/captures/${captureId}/refund`, {
      amount: money(amount),
      note_to_payer: note.slice(0, 255),
    }, `ref-${captureId}`);
    return { refundId: r.id as string, status: r.status as string };
  }

  async addTracking(p: { orderId: string; captureId: string; trackingNumber: string; carrier: string }) {
    const r = await this.call("POST", `/v2/checkout/orders/${p.orderId}/track`, {
      capture_id: p.captureId,
      tracking_number: p.trackingNumber,
      carrier: p.carrier,
      notify_payer: false,
    }, `trk-${p.captureId}`);
    return { id: (r.purchase_units?.[0]?.shipping?.trackers?.[0]?.id ?? r.id ?? p.trackingNumber) as string };
  }

  read(path: string) {
    return this.call("GET", path);
  }

  async verifyWebhook(headers: Record<string, string | string[] | undefined>, event: unknown) {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) return false;
    const h = (k: string) => String(headers[k] ?? "");
    const r = await this.call<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", {
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: event,
    });
    return r.verification_status === "SUCCESS";
  }
}

/** Same flows without PayPal: for development, tests and offline demos. */
export class PayPalMock implements PaymentProvider {
  readonly mode = "mock" as const;
  private auths = new Map<string, { amount: number; status: string }>();
  private setups = new Map<string, { returnUrl: string; approved: boolean }>();
  private n = 1000;
  private id = (p: string) => `${p}-MOCK-${(this.n++).toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  async createSetupToken(returnUrl: string) {
    const id = this.id("SETUP");
    this.setups.set(id, { returnUrl, approved: false });
    return { id, approveUrl: `${BASE_URL}/mock-paypal/approve?token=${id}` };
  }
  /** The mock approval page calls this, then redirects to returnUrl. */
  approveSetup(id: string) {
    const s = this.setups.get(id);
    if (!s) return null;
    s.approved = true;
    return `${s.returnUrl}${s.returnUrl.includes("?") ? "&" : "?"}approval_token_id=${id}`;
  }
  async createPaymentToken(setupTokenId: string) {
    if (!this.setups.get(setupTokenId)?.approved) throw new PayPalError("SETUP_TOKEN_NOT_APPROVED", 422);
    return { id: this.id("VAULT"), payerEmail: "owner@personal.example.com" };
  }
  async authorize(p: { amount: number }) {
    const authorizationId = this.id("AUTH");
    this.auths.set(authorizationId, { amount: p.amount, status: "CREATED" });
    return { orderId: this.id("ORDER"), authorizationId, status: "CREATED" };
  }
  async capture(authorizationId: string) {
    const a = this.auths.get(authorizationId);
    if (!a || a.status !== "CREATED") throw new PayPalError("AUTHORIZATION_ALREADY_COMPLETED", 422);
    a.status = "CAPTURED";
    return { captureId: this.id("CAPTURE"), status: "COMPLETED" };
  }
  async void(authorizationId: string) {
    const a = this.auths.get(authorizationId);
    if (!a || a.status !== "CREATED") throw new PayPalError("AUTHORIZATION_ALREADY_COMPLETED", 422);
    a.status = "VOIDED";
    return { status: "VOIDED" };
  }
  async refund() {
    return { refundId: this.id("REFUND"), status: "COMPLETED" };
  }
  async addTracking(p: { trackingNumber: string }) {
    return { id: `TRACK-MOCK-${p.trackingNumber}` };
  }
  async read(path: string) {
    return { mock: true, path, note: "PayPal mock mode: connect sandbox keys for live data" };
  }
  async verifyWebhook() {
    return false;
  }
}

export function createProvider(): PaymentProvider {
  if (PAYPAL_MODE === "sandbox") {
    const id = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_CLIENT_SECRET;
    if (!id || !secret) throw new Error("PAYPAL_MODE=sandbox needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET");
    return new PayPalSandbox(id, secret);
  }
  return new PayPalMock();
}

