import { protectApiRequest } from "../_security";
import { readJsonObject } from "../_limits";
import { changeTool, publicTool, readTools } from "./store";
import { runTool } from "./run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const catalog = new URL(request.url).searchParams.get("catalog") === "1";
  const denied = protectApiRequest(request, { scope: "n8n-tools-read", limit: 60, loopbackOnly: !catalog });
  if (denied) return denied;
  try { return Response.json({ tools: (await readTools()).map(tool => catalog ? { id: tool.id, name: tool.name, phrases: tool.phrases } : publicTool(tool)) }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "Could not read n8n tool settings." }, { status: 503 }); }
}
export async function POST(request: Request) {
  const denied = protectApiRequest(request, { scope: "n8n-tools-write", limit: 20, loopbackOnly: true });
  if (denied) return denied;
  const body = await readJsonObject(request, 16000);
  if (!body.ok) return body.response;
  try {
    if (body.value.action === "test") {
      if (typeof body.value.id !== "string") throw new Error("Choose a tool to test.");
      const result = await runTool(body.value.id, {}, "Test this configured read tool", request.signal);
      return Response.json({ name: result.name, count: result.count, fetchedAt: result.fetchedAt }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ tools: await changeTool(body.value) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not update n8n tools." }, { status: 400 }); }
}
