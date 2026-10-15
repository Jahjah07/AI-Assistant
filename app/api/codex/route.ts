import { protectApiRequest } from "../_security";
import { readJsonObject } from "../_limits";
import { codexAccount, startCodexLogin, signOutCodex } from "./client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const error = protectApiRequest(request, { scope: "codex-account", limit: 60, loopbackOnly: true });
  if (error) return error;
  try { return Response.json(await codexAccount(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not check Codex login." }, { status: 503 }); }
}

export async function POST(request: Request) {
  const error = protectApiRequest(request, { scope: "codex-login", limit: 10, loopbackOnly: true });
  if (error) return error;
  const body = await readJsonObject(request, 1024);
  if (!body.ok) return body.response;
  try {
    if (body.value.action === "login") return Response.json(await startCodexLogin(), { headers: { "Cache-Control": "no-store" } });
    if (body.value.action === "logout") { await signOutCodex(); return Response.json({ signedIn: false }); }
    return Response.json({ error: "Choose login or logout." }, { status: 400 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Codex login failed." }, { status: 503 }); }
}
