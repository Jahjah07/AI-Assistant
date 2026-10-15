type ApiSecurityOptions = {
  scope: string;
  limit: number;
  windowMs?: number;
  loopbackOnly?: boolean;
  allowExtensionOrigin?: boolean;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const DEFAULT_WINDOW_MS = 60_000;
const rateLimits = new Map<string, RateLimitEntry>();

function safeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return difference === 0;
}

function getCredentials(request: Request) {
  const authorization = request.headers.get("authorization") || "";

  if (!authorization.startsWith("Basic ")) {
    return null;
  }

  try {
    const decoded = atob(authorization.slice(6));
    const separator = decoded.indexOf(":");

    if (separator === -1) {
      return null;
    }

    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function getConfiguredCredentials() {
  return {
    username: (process.env.JIMMY_AUTH_USERNAME ?? process.env.JOHNNY_AUTH_USERNAME)?.trim() || "",
    password: process.env.JIMMY_AUTH_PASSWORD ?? process.env.JOHNNY_AUTH_PASSWORD ?? "",
  };
}

function getHostname(host: string) {
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function getAllowedHosts() {
  return (process.env.JIMMY_ALLOWED_HOSTS ?? process.env.JOHNNY_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedHost(request: Request) {
  const requestHost = request.headers.get("host")?.toLowerCase() || "";
  const requestHostname = getHostname(requestHost);

  return getAllowedHosts().some(
    (allowedHost) =>
      requestHost === allowedHost ||
      (!allowedHost.includes(":") && requestHostname === allowedHost),
  );
}

function isAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (!origin) {
    return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
  }

  try {
    const originUrl = new URL(origin);
    const requestHost = request.headers.get("host")?.toLowerCase() || "";
    const configuredOrigins = (process.env.JIMMY_ALLOWED_ORIGINS ?? process.env.JOHNNY_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase().replace(/\/$/, ""))
      .filter(Boolean);

    return (
      originUrl.host.toLowerCase() === requestHost ||
      configuredOrigins.includes(originUrl.origin.toLowerCase())
    );
  } catch {
    return false;
  }
}

function isLoopbackAddress(value: string) {
  const normalized = value.trim().toLowerCase().replace(/^\[|\]$/g, "");

  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("127.")
  );
}

function isLoopbackRequest(request: Request) {
  const requestHostname = getHostname(request.headers.get("host") || "");
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (!isLoopbackAddress(requestHostname)) {
    return false;
  }

  if (!forwardedFor) {
    return true;
  }

  return forwardedFor
    .split(",")
    .map((address) => address.trim())
    .every(isLoopbackAddress);
}

function isSecureTransport(request: Request) {
  const requestHostname = getHostname(request.headers.get("host") || "");

  if (isLoopbackAddress(requestHostname)) {
    return true;
  }

  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();

  if (forwardedProtocol) {
    return forwardedProtocol === "https";
  }

  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

function jsonError(message: string, status: number, headers?: HeadersInit) {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...headers,
      },
    },
  );
}

export function checkBasicAuthentication(request: Request) {
  if (!isSecureTransport(request)) {
    return jsonError(
      "HTTPS is required when accessing Jimmy over a network.",
      426,
    );
  }

  const configured = getConfiguredCredentials();

  if (!configured.username || !configured.password) {
    return jsonError(
      "Jimmy authentication is not configured on the server.",
      503,
    );
  }

  const provided = getCredentials(request);

  if (
    !provided ||
    !safeEqual(provided.username, configured.username) ||
    !safeEqual(provided.password, configured.password)
  ) {
    return jsonError("Authentication required.", 401, {
      "WWW-Authenticate": 'Basic realm="Jimmy", charset="UTF-8"',
    });
  }

  return null;
}

function checkRateLimit(scope: string, limit: number, windowMs: number) {
  const now = Date.now();
  const current = rateLimits.get(scope);

  if (!current || current.resetAt <= now) {
    rateLimits.set(scope, { count: 1, resetAt: now + windowMs });
    return null;
  }

  if (current.count >= limit) {
    return jsonError("Too many requests. Please try again shortly.", 429, {
      "Retry-After": String(Math.max(1, Math.ceil((current.resetAt - now) / 1000))),
      "X-RateLimit-Limit": String(limit),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(Math.ceil(current.resetAt / 1000)),
    });
  }

  current.count += 1;
  return null;
}

export function protectApiRequest(
  request: Request,
  {
    scope,
    limit,
    windowMs = DEFAULT_WINDOW_MS,
    loopbackOnly = false,
    allowExtensionOrigin = false,
  }: ApiSecurityOptions,
) {
  const authenticationError = checkBasicAuthentication(request);

  if (authenticationError) {
    return authenticationError;
  }

  if (!isAllowedHost(request)) {
    return jsonError("This host is not allowed.", 403);
  }

  if (!isAllowedOrigin(request) && !(allowExtensionOrigin && /^chrome-extension:\/\/[a-p]{32}$/.test(request.headers.get("origin") || ""))) {
    return jsonError("This request origin is not allowed.", 403);
  }

  if (loopbackOnly && !isLoopbackRequest(request)) {
    return jsonError(
      "Local application control is only available through localhost.",
      403,
    );
  }

  return checkRateLimit(scope, limit, windowMs);
}
