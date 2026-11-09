// Checks the PayPal sandbox credentials and the vault ("save payment methods") feature.
import "../server/env.js";
import { PayPalSandbox } from "../server/paypal.js";

const id = process.env.PAYPAL_CLIENT_ID;
const secret = process.env.PAYPAL_CLIENT_SECRET;
if (!id || !secret) {
  console.error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in server/.env");
  process.exit(1);
}
const pp = new PayPalSandbox(id, secret);
try {
  const t = await pp.createSetupToken("http://localhost:4500/api/owner/paypal/return", "http://localhost:5190/?paypal=cancelled");
  console.log(`✓ credentials work\n✓ vault setup token created: ${t.id}\n  approve link: ${t.approveUrl}`);
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  console.error("If it mentions vault or permissions: in the PayPal developer dashboard, open the sandbox app and enable 'Save payment methods'.");
  process.exit(1);
}
