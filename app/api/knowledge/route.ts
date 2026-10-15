import { protectApiRequest } from "../_security";
import { readJsonObject } from "../_limits";
import { forgetKnowledge, learnDocumentation, readKnowledge, saveLesson } from "./store";
import { discoverDocumentation } from "./research";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const denied = protectApiRequest(request, { scope: "knowledge-read", limit: 60, loopbackOnly: true });
  if (denied) return denied;
  return Response.json({ entries: await readKnowledge() }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const denied = protectApiRequest(request, { scope: "knowledge-write", limit: 20, loopbackOnly: true });
  if (denied) return denied;
  const body = await readJsonObject(request, 8192); if (!body.ok) return body.response;
  try {
    const { action, text, url, id, topic } = body.value;
    if (action === "note" && typeof text === "string") return Response.json({ entry: await saveLesson(text) });
    if (action === "learn" && typeof url === "string" && url.length <= 2000) return Response.json({ entry: await learnDocumentation(url, request.signal, true) });
    if (action === "discover" && typeof topic === "string" && topic.length <= 100) return Response.json({ entry: await discoverDocumentation(topic, request.signal, "", true) });
    if (action === "forget" && typeof id === "string" && id.length <= 100) { await forgetKnowledge(id); return Response.json({ removed: true }); }
    throw new Error("Choose a lesson, documentation URL, or entry to forget.");
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not update knowledge." }, { status: 400 }); }
}
