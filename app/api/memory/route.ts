import {
  addMemory,
  clearMemories,
  forgetMemory,
  getMemories,
  getMemoryBackend,
  MemoryLimitError,
} from "./store";
import { readJsonObject } from "../_limits";
import { protectApiRequest } from "../_security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const securityError = protectApiRequest(request, {
    scope: "memory-read",
    limit: 60,
  });

  if (securityError) {
    return securityError;
  }

  return Response.json({
    memories: await getMemories(),
    backend: getMemoryBackend(),
  });
}

export async function POST(request: Request) {
  const securityError = protectApiRequest(request, {
    scope: "memory-write",
    limit: 30,
  });

  if (securityError) {
    return securityError;
  }

  try {
    const bodyResult = await readJsonObject(request, 16_384);

    if (!bodyResult.ok) {
      return bodyResult.response;
    }

    const { action, text: rawText } = bodyResult.value;
    const text = typeof rawText === "string" ? rawText.trim() : "";

    if (typeof rawText === "string" && rawText.length > 2_000) {
      return Response.json(
        { error: "Memory text must not exceed 2,000 characters." },
        { status: 400 },
      );
    }

    if (action === "remember") {
      if (!text) {
        return Response.json({ error: "No memory text was provided." }, { status: 400 });
      }

      return Response.json({ memory: await addMemory(text) });
    }

    if (action === "forget") {
      if (!text) {
        await clearMemories();
        return Response.json({ removed: "all" });
      }

      return Response.json({ removed: await forgetMemory(text) });
    }

    return Response.json({ error: "Unknown memory action." }, { status: 400 });
  } catch (error) {
    if (error instanceof MemoryLimitError) {
      return Response.json({ error: error.message }, { status: 409 });
    }

    const message = error instanceof Error ? error.message : "Unknown error";

    return Response.json({ error: `Memory failed. ${message}` }, { status: 500 });
  }
}
