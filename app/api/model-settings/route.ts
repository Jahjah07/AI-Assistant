import { protectApiRequest } from "../_security";
import { readJsonObject } from "../_limits";
import { keepModelsLoaded, saveKeepModelsLoaded } from "./settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let changing = false;

export async function GET(request: Request) {
  const denied = protectApiRequest(request, { scope: "model-settings-read", limit: 60, loopbackOnly: true });
  if (denied) return denied;
  return Response.json({ keepLoaded: await keepModelsLoaded() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const denied = protectApiRequest(request, { scope: "model-settings-write", limit: 12, loopbackOnly: true });
  if (denied) return denied;
  const body = await readJsonObject(request, 1024);
  if (!body.ok) return body.response;
  const enabled = body.value.keepLoaded;
  if (typeof enabled !== "boolean") return Response.json({ error: "Choose whether to keep models loaded." }, { status: 400 });
  if (changing) return Response.json({ error: "Model settings are already changing." }, { status: 409 });
  changing = true;
  try {
    if (enabled) {
      const results = await Promise.all([
        fetch(`${(process.env.TTS_SERVICE_URL || "http://127.0.0.1:8766").replace(/\/$/, "")}/warm`, {
          method: "POST", headers: { "X-Voice-Service-Secret": process.env.VOICE_SERVICE_SECRET || "" }, signal: AbortSignal.timeout(240000),
        }),
        fetch("http://127.0.0.1:11434/api/generate", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: process.env.OLLAMA_MODEL || "qwen3:4b-instruct", keep_alive: -1, stream: false }), signal: AbortSignal.timeout(240000),
        }),
      ]);
      if (results.some(response => !response.ok)) throw new Error("Could not load Qwen or Kokoro. Check their backend status and try again. A model may have loaded before the other failed.");
    } else if (await keepModelsLoaded()) {
      const response = await fetch("http://127.0.0.1:11434/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: process.env.OLLAMA_MODEL || "qwen3:4b-instruct", keep_alive: "30m", stream: false }), signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error("Could not restore Qwen's idle timeout. Try again or shut down Jimmy to unload its models.");
    }
    await saveKeepModelsLoaded(enabled);
    return Response.json({ keepLoaded: enabled });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not update model settings." }, { status: 503 }); }
  finally { changing = false; }
}
