import { randomInt } from "node:crypto";

import {
  fetchWithTimeout,
  readJsonObject,
  readResponseText,
  ResponseSizeError,
  UpstreamTimeoutError,
} from "../_limits";
import { protectApiRequest } from "../_security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_ID_PATTERN = /"videoId":"([a-zA-Z0-9_-]{11})"/g;

export async function POST(request: Request) {
  const securityError = protectApiRequest(request, {
    scope: "youtube-resolve",
    limit: 30,
  });

  if (securityError) {
    return securityError;
  }

  try {
    const bodyResult = await readJsonObject(request, 8_192);

    if (!bodyResult.ok) {
      return bodyResult.response;
    }

    const rawQuery = bodyResult.value.query;
    const query = typeof rawQuery === "string" ? rawQuery.trim() : "";

    if (!query) {
      return Response.json({ error: "No YouTube query was provided." }, { status: 400 });
    }

    if (query.length > 300) {
      return Response.json(
        { error: "YouTube query must not exceed 300 characters." },
        { status: 400 },
      );
    }

    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const response = await fetchWithTimeout(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
      },
    }, 12_000, request.signal);

    if (!response.ok) {
      return Response.json(
        {
          searchUrl,
          error: `YouTube returned HTTP ${response.status}.`,
        },
        { status: 502 },
      );
    }

    const html = await readResponseText(
      response,
      5 * 1024 * 1024,
      12_000,
      request.signal,
    );
    const seenVideoIds = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = VIDEO_ID_PATTERN.exec(html))) {
      seenVideoIds.add(match[1]);
    }

    const videoIds = [...seenVideoIds].slice(0, 8);
    if (bodyResult.value.random === true) {
      for (let index = videoIds.length - 1; index > 0; index--) {
        const other = randomInt(index + 1);
        [videoIds[index], videoIds[other]] = [videoIds[other], videoIds[index]];
      }
    }
    const firstVideoId = videoIds[0];

    if (!firstVideoId) {
      return Response.json(
        {
          searchUrl,
          error: "Could not find a playable YouTube result.",
        },
        { status: 502 },
      );
    }

    return Response.json({
      videoId: firstVideoId,
      videoIds,
      url: `https://www.youtube.com/watch?v=${firstVideoId}&autoplay=1`,
      searchUrl,
    });
  } catch (error) {
    if (error instanceof UpstreamTimeoutError) {
      return Response.json({ error: "YouTube did not respond within 12 seconds." }, { status: 504 });
    }

    if (error instanceof ResponseSizeError) {
      return Response.json({ error: "YouTube returned an unexpectedly large page." }, { status: 502 });
    }

    const message = error instanceof Error ? error.message : "Unknown error";

    return Response.json(
      { error: `Could not resolve YouTube video. ${message}` },
      { status: 500 },
    );
  }
}
