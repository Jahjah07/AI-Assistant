export function randomMusicQuery(content: string): string | null {
  const text = content.trim().replace(/^(?:please\s+)?play\s+/i, "").replace(/\s+on\s+youtube[.!?]*$/i, "").replace(/[.!?]+$/, "");
  if (!/^(?:please\s+)?play\s+/i.test(content.trim())) return null;
  const match = text.match(/^(?:(?:some|any|random|a random)\s+)?(.*?)\s*(?:music|songs?)$/i);
  if (!match) return null;
  const genre = match[1].trim();
  if (genre && !/^(?:some|any|random|a random)\s+/i.test(text) && !/^(?:classical|jazz|pop|rock|lofi|lo-fi|country|instrumental|relaxing|hip hop|r&b|ambient)$/i.test(genre)) return null;
  if (genre) return `${genre} music`;
  const choices = ["pop songs", "soul music", "acoustic songs", "jazz music", "classic rock songs", "indie music"];
  return choices[Math.floor(Math.random() * choices.length)];
}
