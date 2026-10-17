export type FileCommand = { kind: "local-files"; action: "search" | "storage" | "cancel"; scope: string; query?: string };
export type FileRequestContext = { request: string; command?: FileCommand; question?: string };
export function mayBeFileRequest(text: string, context: FileRequestContext | null) {
  return !!context?.question || /\b(?:files?|folders?|downloads?|downloaded|documents|desktop|storage|disks?|drives?|ssd|hdd|keycaps?|models?)\b|\.(?:3mf|glb|stl)\b|[a-z]:\\/i.test(text)
    || /\b(?:space|room)\b.*\b(?:laptop|computer|pc|full|left|free|running|low)\b|\b(?:laptop|computer|pc)\b.*\b(?:space|room)\b/i.test(text)
    || !!context && (/\b(?:instead|elsewhere|same one|that one|try there|look there|bring it|bring that)\b/i.test(text) || context.command?.action === "search" && /^(?:please\s+)?(?:find|locate|search|look|try|show|open)\b/i.test(text.trim()));
}
export function fileSearchFollowUp(input: string, previous?: FileRequestContext): FileCommand | null {
  if (previous?.command?.action !== "search") return null;
  const match = input.trim().match(/^(?:please\s+)?(?:find|locate|search for)\s+(?:(?:the|my|that)\s+)?(.+?)[.!?]*$/i);
  if (!match || /\b(?:in|on|from|google|web|internet|online|youtube|images?|pictures?|photos?|how|why|delete|remove|rename|move|upload|execute|largest|biggest|storage|space|disk)\b/i.test(match[1])) return null;
  const query = /^(?:it|that|the same (?:file|one))$/i.test(match[1]) ? previous.command.query : match[1];
  if (!query || /^(?:file|model|3d model)$/i.test(query)) return null;
  return { kind: "local-files", action: "search", scope: previous.command.scope, query };
}
export const LOCAL_FILES_SOURCE = "Local laptop · read-only scan";
export const modelFilename = (name: string) => /\.(3mf|glb|stl)$/i.test(name);
export async function loadLocalModel(entry: { name: string; modelToken?: string }, signal: AbortSignal) {
  const response = await fetch("/api/local-files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "model", token: entry.modelToken }), signal });
  if (!response.ok) { const data = await response.json(); throw new Error(data.error || "Could not read this model."); }
  return new File([await response.blob()], entry.name);
}
export const fileSize = (bytes: number) => bytes >= 2 ** 30 ? `${(bytes / 2 ** 30).toFixed(2)} GB` : bytes >= 2 ** 20 ? `${(bytes / 2 ** 20).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
const localScope = (scope: string) => /^(?:(?:my|the) )?(?:(?:downloads?|documents|desktop|pictures|videos|music|home|user|computer|laptop|pc|all drives)(?: folder)?|[a-z](?::| drive)?)[.!]*$/i.test(scope) || /^(?:[a-z]:[\\/]|\/)/i.test(scope);

export function parseFileCommand(input: string): FileCommand | null {
  let text = input.trim().replace(/^(?:hey\s+)?jimmy[\s,.:!-]*/i, "").replace(/^(?:(?:can|could) you |please )/i, "").replace(/[?!]+$/, "").trim();
  if (/^(?:cancel|stop) (?:the |my )?(?:scan|file search|storage scan|laptop scan)[.!]*$/i.test(text)) return { kind: "local-files", action: "cancel", scope: "computer" };
  if (/^(?:(?:find )?what(?:'s| is|s) (?:making|filling|taking up).*(?:storage|disk|drive|space).*|why is my (?:storage|disk|drive).*(?:full|filling)|(?:check|analy[sz]e|scan|show) (?:my |the )?(?:storage|disk usage|disk space)|(?:find|show) (?:the )?(?:largest|biggest) (?:files|folders))[.!]*$/i.test(text)) {
    return { kind: "local-files", action: "storage", scope: "computer" };
  }
  const storage = text.match(/^(?:check|analy[sz]e|scan) (?:storage|disk usage|disk space)(?: in| on| for)? (.+)$/i)
    || text.match(/^(?:find|show) (?:the )?(?:largest|biggest) (?:files|folders) in (.+)$/i);
  if (storage) return { kind: "local-files", action: "storage", scope: storage[1].trim().replace(/[.!]+$/, "") };
  text = text.replace(/\s+(?:and |then )?(?:show|display|open|preview)(?: it| the model)? (?:on|in) (?:the |my |your )?canvas[.!]*$/i, "");
  const locationFirst = text.match(/^(?:find|locate|search for) (?:a |the |my )?(?:file|3d model|model) in (.+?)(?: and (?:the |its )?name is| (?:called|named))\s+(.+)$/i);
  if (locationFirst && localScope(locationFirst[1])) return { kind: "local-files", action: "search", scope: locationFirst[1], query: locationFirst[2].replace(/^['"]|['"]$/g, "").trim() };
  const match = text.match(/^(?:find|locate|search for|preview|display|open)\s+(?:(?:a|the|my)\s+)?(?:(?:3d model|model|file)(?:\s+(?:called|named))?\s+)?(.+?)\s+(?:in|on|from)\s+(.+?)\s*$/i);
  if (!match) {
    const named = text.match(/^(?:find|locate|search for) (?:a |the |my )?(?:file|3d model|model) (?:named|called) (.+)$/i);
    return named ? { kind: "local-files", action: "search", scope: "computer", query: named[1].replace(/^['"]|['"]$/g, "").trim() } : null;
  }
  const scope = match[2].replace(/^(?:my|the)\s+/i, "").replace(/\s+folder$/i, "").replace(/[.!]+$/, "").trim();
  if (!localScope(scope)) return null;
  const query = match[1].replace(/^['"]|['"]$/g, "").trim();
  if (!query) return null;
  return { kind: "local-files", action: "search", scope, query };
}
