const activeRequests = new Map<string, number>();

export type ReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

export class UpstreamTimeoutError extends Error {
  constructor(message = "The upstream service timed out.") {
    super(message);
    this.name = "UpstreamTimeoutError";
  }
}

export class ResponseSizeError extends Error {
  constructor(message = "The upstream response was too large.") {
    super(message);
    this.name = "ResponseSizeError";
  }
}

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status });
}

function getContentLength(request: Request) {
  const value = request.headers.get("content-length");

  if (value === null) {
    return null;
  }

  if (!/^\d+$/.test(value)) {
    return Number.NaN;
  }

  return Number(value);
}

async function readRequestBytes(
  request: Request,
  maximumBytes: number,
): Promise<ReadResult<Uint8Array>> {
  const contentLength = getContentLength(request);

  if (Number.isNaN(contentLength)) {
    return { ok: false, response: errorResponse("Invalid Content-Length header.", 400) };
  }

  if (contentLength !== null && contentLength > maximumBytes) {
    return {
      ok: false,
      response: errorResponse(`Request body must not exceed ${maximumBytes} bytes.`, 413),
    };
  }

  if (!request.body) {
    return { ok: true, value: new Uint8Array() };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > maximumBytes) {
        await reader.cancel("Request body is too large.");
        return {
          ok: false,
          response: errorResponse(
            `Request body must not exceed ${maximumBytes} bytes.`,
            413,
          ),
        };
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, value: bytes };
}

export async function readJsonObject(
  request: Request,
  maximumBytes: number,
): Promise<ReadResult<Record<string, unknown>>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();

  if (contentType !== "application/json") {
    return {
      ok: false,
      response: errorResponse("Content-Type must be application/json.", 415),
    };
  }

  const body = await readRequestBytes(request, maximumBytes);

  if (!body.ok) {
    return body;
  }

  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.value));

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, response: errorResponse("JSON body must be an object.", 400) };
    }

    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, response: errorResponse("Request body contains invalid JSON.", 400) };
  }
}

export async function readMultipartForm(
  request: Request,
  maximumBytes: number,
): Promise<ReadResult<FormData>> {
  const contentType = request.headers.get("content-type") || "";

  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return {
      ok: false,
      response: errorResponse("Content-Type must be multipart/form-data.", 415),
    };
  }

  const body = await readRequestBytes(request, maximumBytes);

  if (!body.ok) {
    return body;
  }

  try {
    const arrayBuffer = body.value.buffer.slice(
      body.value.byteOffset,
      body.value.byteOffset + body.value.byteLength,
    ) as ArrayBuffer;
    const parser = new Response(arrayBuffer, {
      headers: { "Content-Type": contentType },
    });
    return { ok: true, value: await parser.formData() };
  } catch {
    return { ok: false, response: errorResponse("Malformed multipart request body.", 400) };
  }
}

export function acquireConcurrency(scope: string, maximum: number) {
  const current = activeRequests.get(scope) || 0;

  if (current >= maximum) {
    return null;
  }

  activeRequests.set(scope, current + 1);
  let released = false;

  return () => {
    if (released) {
      return;
    }

    released = true;
    const remaining = (activeRequests.get(scope) || 1) - 1;

    if (remaining > 0) {
      activeRequests.set(scope, remaining);
    } else {
      activeRequests.delete(scope);
    }
  };
}

export function concurrencyLimitResponse() {
  return Response.json(
    { error: "This service is busy. Please try again shortly." },
    { status: 503, headers: { "Retry-After": "5" } },
  );
}

export function getBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, minimum), maximum)
    : fallback;
}

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
  parentSignal?: AbortSignal,
) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromParent = () => controller.abort(parentSignal?.reason);

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new UpstreamTimeoutError();
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

export async function readResponseBytes(
  response: Response,
  maximumBytes: number,
  timeoutMs = 30_000,
  parentSignal?: AbortSignal,
) {
  const contentLength = response.headers.get("content-length");

  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maximumBytes) {
    throw new ResponseSizeError();
  }

  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let rejectAbort: (reason: Error) => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const timeout = setTimeout(() => {
    rejectAbort(new UpstreamTimeoutError("The upstream response body timed out."));
    void reader.cancel("Upstream response timed out.");
  }, timeoutMs);
  const abortFromParent = () => {
    rejectAbort(
      parentSignal?.reason instanceof Error
        ? parentSignal.reason
        : new DOMException("Request aborted.", "AbortError"),
    );
    void reader.cancel(parentSignal?.reason);
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > maximumBytes) {
        await reader.cancel("Upstream response is too large.");
        throw new ResponseSizeError();
      }

      chunks.push(value);
    }
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

export async function readResponseText(
  response: Response,
  maximumBytes: number,
  timeoutMs = 30_000,
  parentSignal?: AbortSignal,
) {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    await readResponseBytes(response, maximumBytes, timeoutMs, parentSignal),
  );
}
