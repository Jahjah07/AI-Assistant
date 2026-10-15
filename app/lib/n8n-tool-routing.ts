export type ToolDescriptor = { id: string; name: string; phrases: string[] };
export class ToolError extends Error {}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function gmailRequest(input: string, now = new Date()): Record<string, string | number | boolean> | null {
  const text = input.trim().replace(/^(?:hey\s+)?jimmy[\s,.:!-]*/i, "").replace(/^(?:please\s+|(?:can|could|would) you\s+)+/i, "").replace(/[.!?]+$/, "");
  if (/^(?:(?:get|show|read|check)(?: me)? (?:the )?)?next (?:page of |batch of )?(?:my )?(?:emails?|gmail|messages)$/i.test(text)) return { nextPage: true };
  const match = text.match(/^(check|get|read|find|search(?: for)?|look for)\s+(?:(all|unread)\s+)?(?:my\s+)?(?:(all|unread)\s+)?(?:emails?|gmails?|messages)\b(.*)$/i);
  if (!match) return null;
  const scope = (match[2] || match[3] || "").toLowerCase();
  let tail = match[4].trim();
  const thisWeek = /\s*\b(?:from )?this week$/i.test(tail);
  tail = tail.replace(/\s*\b(?:from )?this week$/i, "").trim();
  const search = tail.match(/^(?:about|regarding|for)\s+(.+)$/i);
  const sender = tail.match(/^from\s+(.+?)(?:\s+(?:about|regarding)\s+(.+))?$/i);
  if (tail && !search && !sender) throw new ToolError('Please say “check my emails”, “check all my emails”, or “find emails from a sender about a topic”. For other filters, use Gmail with JSON containing a query.');
  if (/^(?:find|search|look)/i.test(match[1]) && !search && !sender) throw new ToolError("What sender or topic should I search for?");
  const quote = (value: string) => `"${value.replace(/["\\\r\n]/g, " ").trim()}"`;
  const filters: string[] = [];
  if (scope === "unread" || (!scope && !search && !sender)) filters.push("is:unread");
  if (thisWeek || (!scope && !search && !sender)) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const monday = new Date(`${day}T00:00:00+08:00`);
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    monday.setTime(monday.getTime() - ((weekday + 6) % 7) * 86400000);
    filters.push(`after:${Math.floor(monday.getTime() / 1000)}`);
  }
  if (sender) filters.push(`from:${quote(sender[1])}`);
  if (search || sender?.[2]) filters.push(quote(search?.[1] || sender![2]));
  return { query: filters.join(" "), pageSize: 20, ...(!scope && !thisWeek && !search && !sender ? { sinceLastCheck: true } : {}) };
}

export function selectTool(text: string, tools: ToolDescriptor[]) {
  const normalized = text.trim().replace(/^(?:hey\s+)?jimmy[\s,.:!-]*/i, "").replace(/^please\s+/i, "");
  const explicit = normalized.match(/^(?:use|run|call)\s+(?:the\s+)?(.+?)(?:\s+tool)?(?:\s+with\s+(\{[\s\S]*\}))?[.!?]*$/i);
  if (explicit) {
    const tool = tools.find(tool => tool.name.toLowerCase() === explicit[1].toLowerCase());
    if (tool) {
      let input: unknown = {};
      try { input = explicit[2] ? JSON.parse(explicit[2]) : {}; } catch { throw new ToolError("Use valid JSON parameters, for example: Use Google Sheets with {\"range\":\"Sheet1!A1:C20\"}."); }
      return { tool, input };
    }
  }
  const gmail = tools.find(tool => tool.id === "gmail" || tool.name.toLowerCase() === "gmail");
  const gmailInput = gmail ? gmailRequest(normalized) : null;
  const matches = tools.filter(tool => tool === gmail && gmailInput || tool.phrases.some(phrase => new RegExp(`^(?:(?:can|could|would) you )?${escape(phrase)}(?:[\\s,.!?:]|$)`, "i").test(normalized)));
  if (matches.length > 1) throw new ToolError("More than one tool matches. Say Use followed by the tool name.");
  return matches[0] ? { tool: matches[0], input: matches[0] === gmail && gmailInput ? gmailInput : {} } : null;
}
