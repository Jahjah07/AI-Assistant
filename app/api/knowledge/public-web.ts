import dns from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";

export function publicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) ||
      a === 100 && b >= 64 && b <= 127 || a === 192 && b === 88 && c === 99 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) !== 6 || !/^[23][0-9a-f]{3}:/i.test(address) || /^(?:2002|3fff):/i.test(address)) return false;
  const parts = address.split(":");
  return !(parts[0].toLowerCase() === "2001" && (parseInt(parts[1] || "0", 16) <= 0x1ff || parts[1].toLowerCase() === "db8"));
}

export function publicUrl(input: string) {
  const url = new URL(input);
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const badHost = isIP(host) ? !publicAddress(host) : host === "localhost" || /\.(?:localhost|local|internal|home|lan|test|invalid|onion)$/.test(host) || !host.includes(".");
  if (input.length > 2048 || url.protocol !== "https:" || url.port || url.username || url.password ||
    badHost) {
    throw new Error("Documentation must use a public HTTPS address without credentials or a custom port.");
  }
  url.hash = ""; return url;
}

export async function publicText(input: string, parent?: AbortSignal, redirects = 0): Promise<{ url: string; text: string; contentType: string }> {
  const url = publicUrl(input);
  const signal = AbortSignal.any([AbortSignal.timeout(20000), ...(parent ? [parent] : [])]);
  signal.throwIfAborted();
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await Promise.race([dns.lookup(host, { all: true, verbatim: true }), new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))]);
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error("Private and reserved network destinations are blocked.");
  signal.throwIfAborted();
  const address = addresses.find(item => item.family === 4) || addresses[0];
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: "GET", signal, family: address.family,
      // Pin the validated DNS result so a second lookup cannot reach a private address.
      lookup: (_host, _options, callback) => callback(null, address.address, address.family),
      headers: { Accept: "text/markdown, text/html, text/plain, application/json, application/rss+xml, application/xml", "Accept-Encoding": "identity", "User-Agent": "JimmyDocumentation/0.1" },
    }, response => {
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.destroy();
        if (redirects >= 3 || !response.headers.location) { reject(new Error("Too many documentation redirects.")); return; }
        let next: string;
        try { next = publicUrl(new URL(response.headers.location, url).href).href; } catch (error) { reject(error); return; }
        publicText(next, signal, redirects + 1).then(resolve, reject); return;
      }
      const contentType = response.headers["content-type"] || "";
      if (status !== 200 || !/(?:text\/|json|xml)/i.test(contentType) || response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
        response.destroy(); reject(new Error(`Documentation is unavailable or unsupported (HTTP ${status}).`)); return;
      }
      let size = 0; const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1024 * 1024) { response.destroy(); reject(new Error("Documentation exceeds the 1 MiB fetch limit.")); }
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve({ url: url.href, text: Buffer.concat(chunks).toString("utf8"), contentType }));
    });
    request.on("error", reject); request.end();
  });
}

export function decodeText(text: string) {
  return text.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[\da-f]+);/gi, entity => {
    const known: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
    if (known[entity.toLowerCase()]) return known[entity.toLowerCase()];
    const value = entity.toLowerCase().startsWith("&#x") ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
    return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : " ";
  });
}

export function documentText(input: string) {
  let text = input.replace(/<(script|style|nav|footer|header|aside|form|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const title = decodeText(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  if (/<(?:html|body|main|article)[\s>]/i.test(text)) {
    text = text.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i)?.[1] || text;
    text = decodeText(text.replace(/<\/(?:p|div|h[1-6]|li|pre|section)>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
  }
  return { text, title };
}
