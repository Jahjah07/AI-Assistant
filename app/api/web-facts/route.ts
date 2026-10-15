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

type DuckDuckGoTopic = {
  Text?: string;
  FirstURL?: string;
  Name?: string;
  Topics?: DuckDuckGoTopic[];
};

type DuckDuckGoResponse = {
  AbstractText?: string;
  AbstractSource?: string;
  AbstractURL?: string;
  Answer?: string;
  AnswerType?: string;
  Heading?: string;
  RelatedTopics?: DuckDuckGoTopic[];
};

type WikipediaSearchResponse = {
  pages?: Array<{
    key: string;
    title: string;
    excerpt?: string;
    description?: string;
  }>;
};

type WikipediaSummaryResponse = {
  title?: string;
  extract?: string;
  content_urls?: {
    desktop?: {
      page?: string;
    };
  };
};

async function readJson<T>(response: Response, signal: AbortSignal) {
  const text = await readResponseText(response, 1024 * 1024, 10_000, signal);

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function flattenTopics(topics: DuckDuckGoTopic[] = []): DuckDuckGoTopic[] {
  return topics.flatMap((topic) =>
    topic.Topics?.length ? flattenTopics(topic.Topics) : [topic],
  );
}

async function searchDuckDuckGo(query: string, signal: AbortSignal) {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    no_html: "1",
    no_redirect: "1",
    skip_disambig: "1",
  });
  const response = await fetchWithTimeout(
    `https://api.duckduckgo.com/?${params}`,
    {},
    10_000,
    signal,
  );

  if (!response.ok) {
    return null;
  }

  const data = await readJson<DuckDuckGoResponse>(response, signal);

  if (!data) {
    return null;
  }

  const related = flattenTopics(data.RelatedTopics)
    .filter((topic) => topic.Text && topic.FirstURL)
    .slice(0, 3);

  if (data.AbstractText) {
    return {
      answer: data.AbstractText,
      sourceTitle: data.AbstractSource || data.Heading || "DuckDuckGo",
      sourceUrl: data.AbstractURL || related[0]?.FirstURL || "",
      related,
    };
  }

  if (data.Answer) {
    return {
      answer: data.Answer,
      sourceTitle: data.AnswerType || "DuckDuckGo",
      sourceUrl: related[0]?.FirstURL || "",
      related,
    };
  }

  if (related[0]?.Text) {
    return {
      answer: related[0].Text,
      sourceTitle: related[0].Name || "DuckDuckGo",
      sourceUrl: related[0].FirstURL || "",
      related,
    };
  }

  return null;
}

async function searchWikipedia(query: string, signal: AbortSignal) {
  const searchParams = new URLSearchParams({
    q: query,
    limit: "1",
  });
  const searchResponse = await fetchWithTimeout(
    `https://api.wikimedia.org/core/v1/wikipedia/en/search/page?${searchParams}`,
    {
      headers: {
        "User-Agent": "JimmyLocalAssistant/0.1",
      },
    },
    10_000,
    signal,
  );

  if (!searchResponse.ok) {
    return null;
  }

  const searchData = await readJson<WikipediaSearchResponse>(searchResponse, signal);

  if (!searchData) {
    return null;
  }

  const page = searchData.pages?.[0];

  if (!page?.key) {
    return null;
  }

  const summaryResponse = await fetchWithTimeout(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.key)}`,
    {
      headers: {
        "User-Agent": "JimmyLocalAssistant/0.1",
      },
    },
    10_000,
    signal,
  );

  if (!summaryResponse.ok) {
    return {
      answer: page.excerpt || page.description || page.title,
      sourceTitle: page.title,
      sourceUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.key)}`,
      related: [],
    };
  }

  const summary = await readJson<WikipediaSummaryResponse>(summaryResponse, signal);

  return {
    answer: summary?.extract || page.excerpt || page.description || page.title,
    sourceTitle: summary?.title || page.title,
    sourceUrl:
      summary?.content_urls?.desktop?.page ||
      `https://en.wikipedia.org/wiki/${encodeURIComponent(page.key)}`,
    related: [],
  };
}

export async function POST(request: Request) {
  const securityError = protectApiRequest(request, {
    scope: "web-facts",
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
      return Response.json({ error: "No search query was provided." }, { status: 400 });
    }

    if (query.length > 500) {
      return Response.json(
        { error: "Search query must not exceed 500 characters." },
        { status: 400 },
      );
    }

    const result =
      (await searchDuckDuckGo(query, request.signal).catch((error) => {
        if (request.signal.aborted) {
          throw error;
        }
        return null;
      })) ||
      (await searchWikipedia(query, request.signal).catch((error) => {
        if (
          request.signal.aborted ||
          error instanceof UpstreamTimeoutError ||
          error instanceof ResponseSizeError
        ) {
          throw error;
        }
        return null;
      }));

    if (!result) {
      return Response.json(
        {
          error:
            "I could not find a useful web result. The internet may be unavailable, Sir.",
        },
        { status: 502 },
      );
    }

    return Response.json({
      query,
      ...result,
    });
  } catch (error) {
    if (error instanceof UpstreamTimeoutError) {
      return Response.json(
        { error: "The web search providers did not respond in time." },
        { status: 504 },
      );
    }

    if (error instanceof ResponseSizeError) {
      return Response.json(
        { error: "A web search provider returned an unexpectedly large response." },
        { status: 502 },
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";

    return Response.json(
      { error: `Could not search the internet. ${message}` },
      { status: 500 },
    );
  }
}
