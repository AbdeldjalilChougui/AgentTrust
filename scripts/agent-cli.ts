// pnpm agent "Book me a hotel room in Paris for tomorrow night"   |   pnpm agent attack
const BASE = (process.env.AGENTTRUST_URL ?? "http://localhost:4500").replace(/\/$/, "");
const task = process.argv.slice(2).join(" ") || "Book me the cheapest hotel room in Paris for tomorrow night.";

const ICON: Record<string, string> = { captured: "✅", voided: "↩️ ", blocked: "⛔", refunded: "↩️ ", failed: "✖" };

const res = await fetch(`${BASE}/api/demo/${task === "attack" ? "attack" : "run"}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ task }),
});
if (!res.ok || !res.body) throw new Error(`${res.status} ${await res.text()}`);
let buf = "";
for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
  buf += Buffer.from(chunk).toString();
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const l of lines.filter(Boolean)) {
    const e = JSON.parse(l);
    if (e.type === "start") console.log(`▶ ${e.task} · ${e.model}`);
    else if (e.type === "tool") console.log(`  → ${e.name} ${JSON.stringify(e.args)}`);
    else if (e.type === "step") console.log(`    · ${e.store}: ${e.step}${e.detail ? ` (${e.detail})` : ""}`);
    else if (e.type === "purchase")
      console.log(`  ${ICON[e.purchase.status] ?? "•"} ${e.purchase.status} $${e.purchase.invoiceAmount} ${e.purchase.storeName}${e.purchase.reason ? ` — ${e.purchase.reason}` : ""}`);
    else if (e.type === "answer") console.log(`\n${e.text}`);
    else if (e.type === "error") console.log(`✖ ${e.message}`);
  }
}
