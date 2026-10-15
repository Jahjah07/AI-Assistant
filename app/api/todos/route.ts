import { protectApiRequest } from "../_security";
import { readJsonObject } from "../_limits";
import { changeTodos, getTodos } from "./store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const denied = protectApiRequest(request, { scope: "todos-read", limit: 60 });
  if (denied) return denied;
  try { return Response.json(await getTodos(new URL(request.url).searchParams.get("day") || undefined), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not read tasks." }, { status: 400 }); }
}
export async function POST(request: Request) {
  const denied = protectApiRequest(request, { scope: "todos-write", limit: 40 });
  if (denied) return denied;
  const body = await readJsonObject(request, 12000);
  if (!body.ok) return body.response;
  try { return Response.json(await changeTodos(body.value), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not save tasks." }, { status: 400 }); }
}
