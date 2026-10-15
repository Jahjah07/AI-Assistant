import {
  acquireConcurrency,
  concurrencyLimitResponse,
  fetchWithTimeout,
  readJsonObject,
  readResponseBytes,
  readResponseText,
  ResponseSizeError,
  UpstreamTimeoutError,
} from "../_limits";
import { protectApiRequest } from "../_security";
import { kokoroVoiceIds } from "../../lib/kokoro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TTS_AUDIO_BYTES = 8 * 1024 * 1024;

export async function GET(request: Request) {
  const securityError = protectApiRequest(request, { scope: "tts-settings", limit: 60 });
  if (securityError) return securityError;
  return Response.json(
    { defaultVoice: process.env.KOKORO_VOICE || "am_michael" },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const securityError = protectApiRequest(request, {
    scope: "tts",
    limit: 60,
  });

  if (securityError) return securityError;

  const bodyResult = await readJsonObject(request, 4_096);
  if (!bodyResult.ok) return bodyResult.response;

  const text =
    typeof bodyResult.value.text === "string"
      ? bodyResult.value.text.trim()
      : "";

  if (!text || text.length > 1_000) {
    return Response.json(
      { error: "TTS text must contain 1 to 1,000 characters." },
      { status: 400 },
    );
  }

  const voice = bodyResult.value.voice;
  if (voice !== undefined && (typeof voice !== "string" || !kokoroVoiceIds.has(voice))) {
    return Response.json({ error: "Choose a valid Kokoro voice." }, { status: 400 });
  }

  const secret = process.env.VOICE_SERVICE_SECRET || "";
  if (secret.length < 32) {
    return Response.json(
      { error: "The voice service is not configured." },
      { status: 503 },
    );
  }

  const release = acquireConcurrency("tts", 1);
  if (!release) return concurrencyLimitResponse();

  try {
    const serviceUrl = (
      process.env.TTS_SERVICE_URL || "http://127.0.0.1:8766"
    ).replace(/\/$/, "");
    const response = await fetchWithTimeout(
      `${serviceUrl}/tts`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Voice-Service-Secret": secret,
        },
        body: JSON.stringify({ text, voice }),
      },
      120_000,
      request.signal,
    );

    if (!response.ok) {
      await readResponseText(response, 16 * 1024, 5_000, request.signal).catch(
        () => "",
      );
      return Response.json(
        { error: "Kokoro is warming up or unavailable." },
        { status: 503, headers: { "Retry-After": "2" } },
      );
    }

    const audio = await readResponseBytes(
      response,
      MAX_TTS_AUDIO_BYTES,
      30_000,
      request.signal,
    );
    const body = audio.buffer.slice(
      audio.byteOffset,
      audio.byteOffset + audio.byteLength,
    ) as ArrayBuffer;

    return new Response(body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "audio/wav",
        "X-TTS-Provider": response.headers.get("X-TTS-Provider") || "kokoro",
        "X-TTS-Voice": response.headers.get("X-TTS-Voice") || "",
        "X-TTS-Generation-Ms":
          response.headers.get("X-TTS-Generation-Ms") || "",
      },
    });
  } catch (error) {
    if (error instanceof UpstreamTimeoutError) {
      return Response.json(
        { error: "Kokoro synthesis timed out." },
        { status: 504 },
      );
    }
    if (error instanceof ResponseSizeError) {
      return Response.json(
        { error: "Kokoro generated an unexpectedly large audio file." },
        { status: 502 },
      );
    }
    return Response.json(
      { error: "Could not reach the Kokoro voice service." },
      { status: 503 },
    );
  } finally {
    release();
  }
}
