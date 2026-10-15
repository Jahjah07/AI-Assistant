export function linkName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export class UnknownBrowserShortcutError extends Error {}

export function parseBrowserLink(input: string): string | null {
  const text = input.trim().replace(/^(?:hey\s+)?jimmy[\s,.:!-]*/i, "")
    .replace(/^(?:(?:now|please|okay|ok)[\s,]+|(?:can|could|would)\s+you\s+)+/i, "")
    .replace(/[.!?]+$/, "");
  const match = text.match(/^(?:open|visit|go to|navigate to)\s+(?:the\s+)?(.+?)(?:\s+(?:website|site))?(?:\s+in\s+(?:the |my |a )?(?:browser|new tab))?$/i);
  if (!match) return null;
  const name = match[1].trim();
  return /^(?:my\s+)?(?:local\s+)?n8n$/i.test(name) ? "n8n" : name;
}

export function resolveBrowserLink(name: string, configured: string = "{}", n8nUrl: string = "http://localhost:5678"): string {
  const custom: unknown = JSON.parse(configured);
  if (!custom || typeof custom !== "object" || Array.isArray(custom)) throw new Error("JIMMY_BROWSER_LINKS must be a JSON object of names and URLs.");
  const links = new Map<string, string>([["chatgpt", "https://chatgpt.com/"], ["google", "https://www.google.com/"], ["youtube", "https://www.youtube.com/"]]);
  links.set("n8n", n8nUrl.replace(/\/api\/v1\/?$/, ""));
  for (const [key, value] of Object.entries(custom)) {
    if (typeof value !== "string") throw new Error("Browser shortcut URLs must be strings.");
    links.set(linkName(key), value);
  }
  const target = links.get(linkName(name));
  if (!target) throw new UnknownBrowserShortcutError(`No browser shortcut named "${name}" is configured. Add it to JIMMY_BROWSER_LINKS in .env.local.`);
  const url = new URL(target);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Browser shortcuts must use HTTP or HTTPS URLs without embedded credentials.");
  return url.href;
}
