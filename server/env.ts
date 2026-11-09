import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(ROOT, "server/.env"), quiet: true });

export const PORT = Number(process.env.PORT ?? 4500);
export const BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
export const WEB_URL = (process.env.WEB_URL || "http://localhost:5190").replace(/\/$/, "");
export const PAYPAL_MODE = (process.env.PAYPAL_MODE ?? "mock") as "mock" | "sandbox";
export const DATA_FILE = process.env.DATA_FILE ?? path.join(ROOT, "data/state.json");
export const GEMINI_KEY = process.env.GEMINI_API_KEY ?? "";
export const GEMINI_MODELS = (process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
