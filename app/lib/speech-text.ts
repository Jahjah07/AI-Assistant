const spokenContractions: Record<string, string> = {
  "here's": "here is", "there's": "there is", "it's": "it is", "that's": "that is",
  "what's": "what is", "who's": "who is", "where's": "where is", "how's": "how is",
  "let's": "let us", "i'm": "I am", "you're": "you are", "we're": "we are", "they're": "they are",
  "don't": "do not", "doesn't": "does not", "didn't": "did not", "can't": "cannot", "won't": "will not",
  "isn't": "is not", "aren't": "are not", "wasn't": "was not", "weren't": "were not",
  "haven't": "have not", "hasn't": "has not", "hadn't": "had not",
  "couldn't": "could not", "wouldn't": "would not", "shouldn't": "should not",
};

function websiteName(value: string): string {
  try {
    const host = new URL(value.startsWith("www.") ? `https://${value}` : value).hostname;
    return host.replace(/^(?:www\.|docs\.|developers?\.|help\.)/i, "").split(".")[0];
  } catch { return "the website"; }
}

export function speechText(text: string): string {
  return text
    .replace(/```[^\n]*\n?/g, " ")
    .replace(/!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, "$1")
    .replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, value => {
      const punctuation = value.match(/[.,!?;:]+$/)?.[0] || "";
      return websiteName(value.slice(0, value.length - punctuation.length)) + punctuation;
    })
    .replace(/[0-9#*]\uFE0F?\u20E3/gu, "")
    .replace(/(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u200D\uFE0E\uFE0F\u20E3]|[\u{1F3FB}-\u{1F3FF}])/gu, "")
    .replace(/(^|\n)\s*(?:#{1,6}\s*|>\s*|[-+*]\s+|\d+[.)]\s+)/g, "$1")
    .replace(/[*_`~#]/g, "")
    .replace(/[\u2018\u2019\u02BC\uFF07]/g, "'")
    .replace(/\\'/g, "'")
    .replace(/\b[a-z]+(?:'[a-z]+)+\b/gi, word => spokenContractions[word.toLowerCase()] || word)
    .replace(/\s+/g, " ").trim();
}

export function nextSpeechChunk(buffer: string, final: boolean, started: boolean) {
  if (!final && /^\s*\d+[.)]\s*$/.test(buffer)) return null;
  const sentence = buffer.match(/^([\s\S]*?[.!?](?:["')\]]*)?)(?:\s+|$)/);
  let end = sentence?.[0].length || 0;
  const limit = started ? 220 : 90;
  if ((!end || end > limit) && buffer.length >= limit) {
    const space = buffer.lastIndexOf(" ", limit);
    if (space > (started ? 80 : 35)) end = space;
  }
  if (!end && final) end = buffer.length;
  if (!end) return null;

  // Keep links/URLs intact across streamed tokens, so paths never reach TTS as fragments.
  const protectedText = /!?\[[^\]]*\](?:\((?:[^()]|\([^()]*\))*(?:\)|$))?|!?\[[^\]]*$|(?:https?:\/\/|www\.)[^\s<>]+|```[\s\S]*?(?:```|$)/g;
  for (const match of buffer.matchAll(protectedText)) {
    const start = match.index, stop = start + match[0].length;
    const incomplete = stop === buffer.length && !final;
    if (start < end && (stop > end || incomplete)) {
      end = start || (incomplete ? 0 : stop);
      break;
    }
  }
  return end ? { text: buffer.slice(0, end), rest: buffer.slice(end).trimStart() } : null;
}
