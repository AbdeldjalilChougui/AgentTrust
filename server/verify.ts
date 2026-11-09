// Did the store deliver what was bought? Cheap checks first, then an AI
// judgement of the content against the product's promised deliverable.
import { askJson, geminiReady } from "./gemini.js";
import type { Product } from "./db.js";

export type Verdict = { ok: boolean; by: "checks" | "ai"; reason: string };

export async function verifyDelivery(product: Product, body: string, contentType: string): Promise<Verdict> {
  if (!body.trim()) return { ok: false, by: "checks", reason: "empty delivery" };
  if (product.kind === "data" || product.kind === "digital") {
    if (!contentType.includes("json")) return { ok: false, by: "checks", reason: `expected structured data, got ${contentType || "no content type"}` };
    try {
      const v = JSON.parse(body);
      if (!v || typeof v !== "object") return { ok: false, by: "checks", reason: "empty data" };
      if ("error" in v) return { ok: false, by: "checks", reason: `store error: ${String(v.error)}` };
    } catch {
      return { ok: false, by: "checks", reason: "delivery is not valid JSON" };
    }
  }
  if (!geminiReady()) return { ok: true, by: "checks", reason: "format checks passed" };
  try {
    const v = await askJson<{ ok: boolean; reason: string }>(
      `You check deliveries for an AI agent's purchases. Answer JSON only: {"ok": true|false, "reason": "<12 words max>"}.
Product: ${product.name}
Promised deliverable: ${product.deliverable}
Delivery (truncated):
${body.slice(0, 1500)}
Digital goods (files, e-books, software) arrive as a download link, licence key or ticket code; services as a booking confirmation or booking link; physical goods as a shipping confirmation with a tracking number. That counts as delivered.
Placeholders, "coming soon", empty file lists or lorem ipsum do NOT count.
Is this delivery what was promised? Be strict about wrong, unrelated, placeholder, error or empty content; lenient about format details.`,
    );
    return { ok: !!v.ok, by: "ai", reason: String(v.reason ?? "").slice(0, 160) || (v.ok ? "matches the order" : "does not match the order") };
  } catch {
    // AI unavailable (quota): the format checks already passed.
    return { ok: true, by: "checks", reason: "format checks passed (AI check unavailable)" };
  }
}
