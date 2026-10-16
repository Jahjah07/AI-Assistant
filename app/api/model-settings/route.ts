import { protectApiRequest } from "../_security";
import { readJsonObject, readResponseText } from "../_limits";
import { readModelSettings, saveModelSettings } from "./settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let changing = false;

async function installedModels() {
  const response = await fetch("http://127.0.0.1:11434/api/tags", { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Could not list models. Open Ollama and refresh the list.");
  const data = JSON.parse(await readResponseText(response, 2_000_000, 5000));
  if (!Array.isArray(data.models)) throw new Error("Ollama returned an invalid model list.");
  return (data.models as { name?: unknown; size?: unknown; remote_host?: unknown; remote_model?: unknown }[])
    .filter(item => item && typeof item.name === "string" && item.name.length <= 200 && !item.remote_host && !item.remote_model && !/(?:[:\-])cloud$/i.test(item.name))
    .map(item => ({ name: item.name as string, size: typeof item.size === "number" && Number.isFinite(item.size) && item.size >= 0 ? item.size : 0 }));
}

async function keepAlive(model: string, duration: string | number) {
  const response = await fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, keep_alive: duration, stream: false }), signal: AbortSignal.timeout(duration === -1 ? 240000 : 30000),
  });
  if (!response.ok && !(duration === 0 && response.status === 404)) throw new Error("Could not update the chat model in Ollama. Check available RAM/VRAM and try again.");
}

export async function GET(request: Request) {
  const denied = protectApiRequest(request, { scope: "model-settings-read", limit: 60, loopbackOnly: true });
  if (denied) return denied;
  try {
    const settings = await readModelSettings();
    let models: { name: string; size: number }[] = [], modelsError = "";
    try { models = await installedModels(); }
    catch { modelsError = "Could not list models. Open Ollama and refresh the list."; }
    return Response.json({ ...settings, models, modelsError }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Could not read saved model settings. No settings were overwritten." }, { status: 503 }); }
}

export async function POST(request: Request) {
  const denied = protectApiRequest(request, { scope: "model-settings-write", limit: 12, loopbackOnly: true });
  if (denied) return denied;
  const body = await readJsonObject(request, 1024);
  if (!body.ok) return body.response;
  const { keepLoaded, model } = body.value;
  if ((keepLoaded === undefined && model === undefined) || (keepLoaded !== undefined && typeof keepLoaded !== "boolean") || (model !== undefined && (typeof model !== "string" || !model.trim() || model.length > 200))) {
    return Response.json({ error: "Choose an installed chat model or whether to keep models loaded." }, { status: 400 });
  }
  if (changing) return Response.json({ error: "Model settings are already changing." }, { status: 409 });
  changing = true;
  let candidate = "";
  try {
    const current = await readModelSettings();
    const next = { keepLoaded: typeof keepLoaded === "boolean" ? keepLoaded : current.keepLoaded, model: typeof model === "string" ? model : current.model };
    if (model !== undefined) {
      if (!(await installedModels()).some(item => item.name === next.model)) return Response.json({ error: "Choose a local model installed in Ollama. Refresh after installing one." }, { status: 400 });
      const response = await fetch("http://127.0.0.1:11434/api/show", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: next.model }), signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Could not inspect this model. Refresh the model list and try again.");
      const info = JSON.parse(await readResponseText(response, 2_000_000, 10000));
      if (!Array.isArray(info.capabilities) || !info.capabilities.includes("completion") || info.remote_host || info.remote_model) {
        return Response.json({ error: "Choose a local text-generation model. Embedding-only and cloud models cannot be used as this brain." }, { status: 400 });
      }
    }
    if (next.model !== current.model) await keepAlive(current.model, 0);
    else if (current.keepLoaded && !next.keepLoaded) await keepAlive(current.model, "30m");
    if (next.keepLoaded) {
      if (!current.keepLoaded || next.model !== current.model) candidate = next.model;
      const results = await Promise.allSettled([
        fetch(`${(process.env.TTS_SERVICE_URL || "http://127.0.0.1:8766").replace(/\/$/, "")}/warm`, {
          method: "POST", headers: { "X-Voice-Service-Secret": process.env.VOICE_SERVICE_SECRET || "" }, signal: AbortSignal.timeout(240000),
        }),
        keepAlive(next.model, -1),
      ]);
      if (results[1].status === "rejected") throw results[1].reason;
      if (results[0].status === "rejected" || !results[0].value.ok) throw new Error("Could not load Kokoro. The previous settings were kept; check voice backend status.");
    }
    await saveModelSettings(next);
    return Response.json(next);
  } catch (error) {
    if (candidate) await keepAlive(candidate, 0).catch(() => {});
    return Response.json({ error: error instanceof Error ? error.message : "Could not update model settings." }, { status: 503 });
  } finally { changing = false; }
}
