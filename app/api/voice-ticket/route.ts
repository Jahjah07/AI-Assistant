import { createHmac, randomBytes } from "node:crypto";

import { protectApiRequest } from "../_security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const securityError = protectApiRequest(request, {
    scope: "voice-ticket",
    limit: 20,
  });

  if (securityError) {
    return securityError;
  }

  const secret = process.env.VOICE_SERVICE_SECRET || "";
  const configuredUrl =
    process.env.VOICE_SERVICE_PUBLIC_WS_URL ||
    "ws://127.0.0.1:8765/ws/voice";

  if (secret.length < 32) {
    return Response.json(
      { error: "The real-time voice service is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    return Response.json(
      { error: "VOICE_SERVICE_PUBLIC_WS_URL is invalid." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    return Response.json(
      { error: "The voice service URL must use ws:// or wss://." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const expires = Math.floor(Date.now() / 1000) + 30;
  const nonce = randomBytes(18).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${expires}.${nonce}`)
    .digest("hex");

  url.searchParams.set("expires", String(expires));
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("signature", signature);

  return Response.json(
    { url: url.toString(), expires },
    { headers: { "Cache-Control": "no-store" } },
  );
}

