// Gemini via the Interactions API (REST). Free-tier quotas are per model and
// per day, so a rate-limited model hands over to the next one in the list.
import { GEMINI_KEY, GEMINI_MODELS } from "./env.js";

const URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
let modelIdx = 0;

export const geminiReady = () => !!GEMINI_KEY;
export const currentModel = () => GEMINI_MODELS[modelIdx];

export type Step = { type: string; id?: string; name?: string; arguments?: Record<string, unknown>; content?: { type: string; text?: string }[] };

export async function interact(request: object): Promise<{ id: string; steps?: Step[] }> {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY is missing");
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
        body: JSON.stringify({ model: GEMINI_MODELS[modelIdx], ...request }),
        signal: AbortSignal.timeout(90_000),
      });
      const json = await res.json();
      if (res.status === 429 && modelIdx < GEMINI_MODELS.length - 1) {
        modelIdx++;
        attempt--;
        continue;
      }
      if (!res.ok) throw new Error(json.error?.message ?? `Gemini returned ${res.status}`);
      return json;
    } catch (e) {
      if (attempt >= 1 || /model|key|quota|credits|429/i.test((e as Error).message)) throw e;
    }
  }
}

export const textOf = (steps: Step[] = []) =>
  steps
    .filter((s) => s.type === "model_output")
    .flatMap((s) => s.content ?? [])
    .map((c) => c.text ?? "")
    .join("");

/** One prompt, JSON back. */
export async function askJson<T>(prompt: string): Promise<T> {
  const r = await interact({ input: prompt, generation_config: { thinking_level: "minimal" } });
  const text = textOf(r.steps).trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  return JSON.parse(text.slice(text.indexOf(text.match(/[[{]/)?.[0] ?? "{")));
}
