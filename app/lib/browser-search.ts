export type BrowserSearch = { kind: "browser-search"; query: string; images: boolean };

export function parseBrowserSearch(input: string, previous: BrowserSearch | null = null): BrowserSearch | null {
  const text = input.trim().replace(/^(?:hey\s+)?jimmy[\s,.:!-]*/i, "")
    .replace(/^(?:(?:now|please|okay|ok)[\s,]+|(?:can|could|would)\s+you\s+)+/i, "")
    .replace(/[.!?]+$/, "");
  const match = text.match(/^(?:look\s+up|search(?:\s+(?:the\s+)?(?:web|internet|google))?(?:\s+for)?|google|find|show\s+me)\s+(.+)$/i);
  if (!match) {
    const correction = text.match(/^(?:i\s+mean|i\s+meant|no[, ]+i\s+mean|actually(?:[, ]+i\s+mean)?|sorry(?:[, ]+i\s+meant)?)[\s,]+(?:the\s+)?(.+)$/i);
    if (!previous || !correction?.[1]?.trim()) return null;
    return { ...previous, query: correction[1].trim() };
  }
  let query = match[1].trim();
  const image = query.match(/^(?:any\s+|some\s+)?(?:images?|pictures?|photos?)(?:\s+(?:of|for))?\s+(.+)$/i);
  // "Find" and "show me" alone can refer to existing assistant tools.
  if (!image && /^(?:find|show\s+me)\s/i.test(text)) return null;
  if (image) query = image[1].trim();
  return query ? { kind: "browser-search", query, images: Boolean(image) } : null;
}

export function browserSearchUrl(query: string, images: boolean): string {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  if (images) url.searchParams.set("tbm", "isch");
  return url.toString();
}
