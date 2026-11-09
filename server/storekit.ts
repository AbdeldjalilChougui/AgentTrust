// The store kit: a merchant describes the shop in plain words or pastes a
// product list, and AI turns it into an agent-ready store with a catalog and a
// storefront that speaks the AgentTrust protocol.
import { askJson, geminiReady } from "./gemini.js";
import { BASE_URL } from "./env.js";
import { db, newId, now, round2, save, type Product, type Store } from "./db.js";

type Draft = {
  name: string;
  description: string;
  category: string;
  products: { name: string; description: string; price: number; category: string; deliverable: string; kind: "data" | "digital" | "service" | "physical" }[];
};

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "store";

/** Without AI: "name, price, description" lines. */
function parseLines(text: string, name: string): Draft {
  const products = text
    .split(/\r?\n/)
    .map((l) => l.split(/[,;\t]/).map((x) => x.trim()))
    .filter((c) => c.length >= 2 && !Number.isNaN(parseFloat(c[1])))
    .slice(0, 20)
    .map(([n, price, ...rest]) => ({
      name: n.slice(0, 60),
      description: (rest.join(", ") || n).slice(0, 160),
      price: round2(parseFloat(price)),
      category: "digital",
      deliverable: `The digital product "${n}" (licence key and download link)`,
      kind: "digital" as const,
    }));
  return { name, description: `${name}, digital products`, category: "digital", products };
}

export async function draftStore(input: { name: string; text: string }): Promise<{ draft: Draft; by: "ai" | "parser" }> {
  if (geminiReady()) {
    try {
      const draft = await askJson<Draft>(`Turn this merchant's description into a store catalog for AI shopping agents.
Answer JSON only:
{"name": string (<=32 chars), "description": string (<=120), "category": one of ["travel","books","software","gifts","services","tickets","design","education","food","digital"],
 "products": [{"name": string (<=60), "description": string (<=160), "price": number in USD, "category": same set,
   "deliverable": "what the buyer receives, e.g. \"a download link and licence key for <product>\" (digital), \"a booking confirmation\" (service), \"a shipping confirmation with a tracking number\" (physical)", "kind": "digital"|"service"|"physical"}] (1 to 12 products)}
Use the merchant's prices when given; otherwise suggest fair prices. Store name if given: "${input.name}".
Merchant input:
${input.text.slice(0, 4000)}`);
      if (draft?.products?.length) return { draft, by: "ai" };
    } catch {
      // fall back to the line parser
    }
  }
  const draft = parseLines(input.text, input.name || "My store");
  if (!draft.products.length) throw new Error('Could not read products. Use lines like "Logo pack, 9.99, 20 SVG logos".');
  return { draft, by: "parser" };
}

export function publishStore(d: Draft & { payeeEmail?: string }): Store {
  let slug = slugify(d.name);
  while (db().stores.some((s) => s.slug === slug)) slug = `${slug.slice(0, 28)}-${Math.random().toString(36).slice(2, 5)}`;
  const store: Store = {
    id: newId("store"),
    slug,
    name: d.name.slice(0, 32),
    description: d.description.slice(0, 160),
    category: d.category || "digital",
    storefrontUrl: `${BASE_URL}/stores/${slug}`,
    // Orders pay this PayPal account directly (a sandbox business account in the demo).
    payeeEmail: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.payeeEmail ?? "") ? d.payeeEmail : undefined,
    products: d.products.slice(0, 12).map((p, i): Product => ({
      id: `${slug}-${i + 1}`,
      name: p.name.slice(0, 60),
      description: p.description.slice(0, 160),
      price: round2(Math.max(0.01, Number(p.price) || 1)),
      category: p.category || d.category || "digital",
      deliverable: p.deliverable || `The product "${p.name}"`,
      kind: p.kind === "service" || p.kind === "physical" ? p.kind : "digital",
    })),
    behavior: "honest",
    createdBy: "store-kit",
    createdAt: now(),
    stats: { sales: 0, delivered: 0, voided: 0, refunded: 0, revenue: 0 },
  };
  db().stores.push(store);
  save();
  return store;
}
