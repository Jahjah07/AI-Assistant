export type LocalAppCommand = { action: "open" | "close" | "close-all"; app?: string };

export function validAppName(name: unknown): name is string {
  return typeof name === "string" && /^[\p{L}\p{N}][\p{L}\p{N} ._'’()+&-]{0,99}$/u.test(name);
}

export function parseLocalAppCommand(input: string): LocalAppCommand | null {
  const text = input.trim().replace(/^(?:hey\s+)?jimmy[\s,.:!-]*/i, "")
    .replace(/^(?:(?:now|please|okay|ok)[\s,]+|(?:can|could|would)\s+you\s+)+/i, "")
    .replace(/[.!?]+$/, "").replace(/,?\s+please$/i, "").trim();
  if (/^(?:close|quit|exit|stop) (?:all|every)(?: approved)? (?:apps?|applications?)$/i.test(text)) return { action: "close-all" };
  const match = text.match(/^(open|launch|start|run|close|quit|exit|stop)\s+(?:(?:my|the)\s+)?(.+)$/i);
  if (!match) return null;
  const name = match[2].replace(/^to\s+(?=(?:roblox|row\s*blocks)$)/i, "").trim();
  if (!validAppName(name) || /\b(?:website|site|browser|new tab)$/i.test(name)) return null;
  const aliases: Record<string, string> = { brave: "brave", "brave browser": "brave", chrome: "chrome", "google chrome": "chrome", "visual studio": "visual-studio", "visual studio code": "visual-studio", vscode: "visual-studio", "vs code": "visual-studio", code: "visual-studio", vs: "visual-studio", steam: "steam", "local n8n": "n8n" };
  const app = /^(?:row\s*blocks|roblox)$/i.test(name) ? "Roblox" : aliases[name.toLowerCase()] || name;
  const action = /^(?:close|quit|exit|stop)$/i.test(match[1]) ? "close" : "open";
  return { action, app };
}
